/**
 * Moderator Agent for managing the meeting
 */

import chalk, { Chalk } from 'chalk';
import { type MessageParams, createMessage } from '../api/client.js';
import {
  createAgendaTransitionPrompt,
  createMeetingConclusionPrompt,
  createMeetingStartPrompt,
} from '../api/prompts.js';
import type { Message, ModeratorOptions, PersonaDirectory, PersonaInfo, TokenUsage } from '../types.js';
import { debugLog } from '../utils/formatting.js';
import { withRetryLogic } from '../utils/retries.js';
import { Agent } from './agent.js';

/**
 * Specialized agent that moderates the meeting
 */
export class ModeratorAgent extends Agent {
  agenda: string[];
  currentAgendaItem: number;
  availablePersonas: PersonaDirectory;
  selectedPersonas: Record<string, PersonaInfo>;
  meetingPurpose: string;

  /**
   * Create a new moderator agent
   */
  constructor({
    client,
    agenda,
    availablePersonas,
    lowEndModel = 'claude-3-haiku-20240307',
    highEndModel = 'claude-3-opus-20240229',
    meetingPurpose = 'Weekly team meeting',
  }: ModeratorOptions) {
    super({
      agentId: 'moderator',
      name: 'Meeting Moderator',
      persona: 'Professional meeting facilitator who ensures discussions stay on track and all voices are heard',
      role: 'Moderator',
      color: chalk.whiteBright,
      client,
      lowEndModel,
      highEndModel,
    });

    this.agenda = agenda;
    this.currentAgendaItem = 0;
    this.availablePersonas = availablePersonas;
    this.selectedPersonas = {};
    this.meetingPurpose = meetingPurpose;
  }

  /**
   * Select which personas should participate in the meeting based on the agenda
   */
  async selectParticipants(): Promise<Record<string, PersonaInfo>> {
    const systemPrompt = `
      You are a meeting moderator planning the participants for a meeting.
      
      The meeting agenda is:
      ${JSON.stringify(this.agenda, null, 2)}
      
      Available personas are:
      ${JSON.stringify(
        Object.fromEntries(Object.entries(this.availablePersonas).map(([k, v]) => [k, v.description])),
        null,
        2,
      )}
      
      Select which personas should attend this meeting based on the agenda items.
      Return ONLY a JSON array of persona IDs that should attend, nothing else.
    `;

    try {
      const response = await this.client.messages.create({
        model: this.highEndModel,
        max_tokens: 500,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: 'Select the participants for this meeting.',
          },
        ],
      });

      // Extract JSON array from response
      let responseText = '';
      const last = response.content[response.content.length - 1];
      if (last.type === 'text') {
        responseText = last.text.trim();
      }

      // Find JSON array in the text (handle cases where Claude adds explanation)
      const jsonMatch = responseText.match(/\[(.*)\]/s);
      let selectedIds: string[];

      if (jsonMatch) {
        const jsonText = `[${jsonMatch[1]}]`;
        selectedIds = JSON.parse(jsonText.replace(/\n/g, ''));
      } else {
        // Fallback if regex fails
        selectedIds = JSON.parse(responseText);
      }

      // Filter to only include available personas
      selectedIds = selectedIds.filter((pid) => this.availablePersonas[pid]);

      // Ensure we have at least 2 participants plus moderator
      if (selectedIds.length < 2) {
        // Add a few random personas if not enough were selected
        const additionalNeeded = 2 - selectedIds.length;
        const availableIds = Object.keys(this.availablePersonas).filter((id) => !selectedIds.includes(id));

        if (availableIds.length > 0) {
          for (let i = 0; i < Math.min(additionalNeeded, availableIds.length); i++) {
            const randomIndex = Math.floor(Math.random() * availableIds.length);
            selectedIds.push(availableIds[randomIndex]);
            availableIds.splice(randomIndex, 1);
          }
        }
      }

      // Create selected personas dict
      const selected: Record<string, PersonaInfo> = {};
      for (const pid of selectedIds) {
        selected[pid] = this.availablePersonas[pid];
      }

      return selected;
    } catch (error: unknown) {
      console.error('Error selecting participants:', error);

      // Fallback: select a random subset of 2-4 personas
      const availableIds = Object.keys(this.availablePersonas);
      const numToSelect = Math.min(4, availableIds.length);
      const selectedIds: string[] = [];

      for (let i = 0; i < numToSelect; i++) {
        const randomIndex = Math.floor(Math.random() * availableIds.length);
        selectedIds.push(availableIds[randomIndex]);
        availableIds.splice(randomIndex, 1);
      }

      const selected: Record<string, PersonaInfo> = {};
      for (const pid of selectedIds) {
        selected[pid] = this.availablePersonas[pid];
      }

      return selected;
    }
  }

  /**
   * Generate the meeting introduction and first agenda item
   */
  async startMeeting(): Promise<string> {
    const systemPrompt = createMeetingStartPrompt(this.meetingPurpose, this.agenda);

    const messageParams: MessageParams = {
      model: this.highEndModel,
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Please start the meeting.' }],
      stream: false,
    };

    const response = await createMessage(
      this.client,
      { ...messageParams, stream: false },
      'starting meeting',
      `Welcome everyone to our meeting on ${this.meetingPurpose}. Let's get started with our first agenda item: ${this.agenda[0]}.`,
    );

    this.currentAgendaItem = 0;
    return response.content[0].text;
  }

  /**
   * Move to the next agenda item and generate a transition message
   */
  async nextAgendaItem(conversation: Message[]): Promise<string | null> {
    this.currentAgendaItem += 1;
    if (this.currentAgendaItem >= this.agenda.length) {
      // This will be ignored since we check for null return in meeting.js
      // Keep it for backward compatibility if called directly
      await this.endMeeting(conversation);
      return null; // Signal that the meeting is over
    }

    // Get relevant messages for the current agenda item
    const currentItemMessages: Message[] = [];
    let foundStart = false;

    for (let i = conversation.length - 1; i >= 0; i--) {
      const message = conversation[i];

      if (
        !foundStart &&
        message.agentId === 'moderator' &&
        message.content.includes(this.agenda[this.currentAgendaItem - 1])
      ) {
        foundStart = true;
      }

      if (foundStart) {
        currentItemMessages.unshift(message);
      }
    }

    const systemPrompt = createAgendaTransitionPrompt(
      this.agenda[this.currentAgendaItem - 1],
      this.agenda[this.currentAgendaItem],
    );

    const userContent = `Discussion transcript for the previous agenda item:\n${currentItemMessages
      .map((m) => `${m.agentId || 'User'}: ${m.content}`)
      .join('\n')}`;

    const fallbackMessage = `Thank you for the discussion on "${this.agenda[this.currentAgendaItem - 1]}". Let's move on to our next agenda item: "${this.agenda[this.currentAgendaItem]}".`;

    // Use retry logic for agenda item transition
    const response = await withRetryLogic(
      // API call function
      async () => {
        const res = await this.client.messages.create({
          model: this.highEndModel,
          max_tokens: 350,
          system: systemPrompt,
          messages: [{ role: 'user', content: userContent }],
        });

        // Check response validity
        if (!res || !res.content || !res.content.length) {
          throw new Error('Empty response received from API');
        }

        return {
          ...res,
          content: res.content.filter((c) => c.type === 'text'),
        };
      },
      // Description
      `transitioning to agenda item "${this.agenda[this.currentAgendaItem]}"`,
      // Options
      {
        fallbackFn: async (error) => {
          console.log(chalk.yellow(`\n⚠️ Using fallback transition due to API error: ${error.message}`));

          return {
            content: [{ text: fallbackMessage }],
            usage: {
              input_tokens: 0,
              output_tokens: fallbackMessage.length / 4,
            } as TokenUsage,
          };
        },
      },
    );

    return response.content[0].text;
  }

  /**
   * Generate a meeting conclusion message
   */
  async endMeeting(conversation: Message[]): Promise<string> {
    const systemPrompt = createMeetingConclusionPrompt(this.agenda);

    // Get the last portion of the conversation to summarize
    const recentMessages = conversation.slice(-Math.min(20, conversation.length));
    const userContent = `Meeting transcript excerpt:\n${recentMessages
      .map((m) => `${m.agentId || 'User'}: ${m.content}`)
      .join('\n')}`;

    const fallbackMessage = `Thank you everyone for your participation in today's meeting. We've covered all our agenda items and had some productive discussions. I'll follow up with a more detailed summary later, but for now, let's consider the meeting adjourned.`;

    // Use retry logic for meeting conclusion
    const response = await withRetryLogic(
      // API call function
      async () => {
        const res = await this.client.messages.create({
          model: this.highEndModel,
          max_tokens: 400,
          system: systemPrompt,
          messages: [{ role: 'user', content: userContent }],
        });

        // Check response validity
        if (!res || !res.content || !res.content.length) {
          throw new Error('Empty response received from API');
        }

        return {
          ...res,
          content: res.content.filter((c) => c.type === 'text'),
        };
      },
      // Description
      'generating meeting conclusion',
      // Options
      {
        fallbackFn: async (error) => {
          console.log(chalk.yellow(`\n⚠️ Using fallback meeting conclusion due to API error: ${error.message}`));

          return {
            content: [{ text: fallbackMessage }],
            usage: {
              input_tokens: 0,
              output_tokens: fallbackMessage.length / 4,
            } as TokenUsage,
          };
        },
      },
    );

    return response.content[0].text;
  }

  /**
   * Generate a comprehensive meeting summary for the transcript
   */
  async generateMeetingSummary(conversation: Message[]): Promise<string> {
    const systemPrompt = `
      You are the meeting moderator creating a detailed summary of a meeting that just concluded.
      
      The meeting purpose was: "${this.meetingPurpose}"
      
      The meeting agenda was:
      ${JSON.stringify(this.agenda, null, 2)}
      
      Write a comprehensive but concise summary that includes:
      1. Key points discussed for each agenda item
      2. Important decisions that were made
      3. Action items and who is responsible for them (if specified)
      4. Any important questions that were raised and their answers
      5. Any major challenges or disagreements that were discussed
      6. Next steps for the team
      
      IMPORTANT FORMATTING RULES:
      - DO NOT include a "Meeting Summary" heading - that will be added separately
      - Use level 3 headings (###) for all section headers, not level 1 or 2
      - Use bullet points for lists
      - Keep the overall structure clean and consistent
      
      The summary should be thorough enough to be useful to someone who didn't attend.
      Aim for 300-500 words.
    `;

    // Get the entire conversation to summarize
    const userContent = `Full meeting transcript:\n${conversation
      .map((m) => `${m.agentId || 'User'}: ${m.content}`)
      .join('\n')}`;

    const fallbackMessage = `This meeting covered our agenda items related to ${this.meetingPurpose}. The team discussed various perspectives and shared insights on each topic. Due to technical limitations, a detailed summary could not be generated, but the full transcript below captures all discussions that took place.`;

    // Use retry logic for meeting summary
    const response = await withRetryLogic(
      // API call function
      async () => {
        const res = await this.client.messages.create({
          model: this.highEndModel,
          max_tokens: 1000,
          system: systemPrompt,
          messages: [{ role: 'user', content: userContent }],
        });

        // Check response validity
        if (!res || !res.content || !res.content.length) {
          throw new Error('Empty response received from API');
        }

        return {
          ...res,
          content: res.content.filter((c) => c.type === 'text'),
        };
      },
      // Description
      'generating detailed meeting summary',
      // Options
      {
        fallbackFn: async (error) => {
          console.log(chalk.yellow(`\n⚠️ Using fallback meeting summary due to API error: ${error.message}`));

          return {
            content: [{ text: fallbackMessage }],
            usage: {
              input_tokens: 0,
              output_tokens: fallbackMessage.length / 4,
            } as TokenUsage,
          };
        },
      },
    );

    return response.content[0].text;
  }

  /**
   * Decide which agent should speak next
   */
  async chooseNextSpeaker(
    agents: Record<string, Agent>,
    conversation: Message[],
    lastSpeakerId: string | null = null,
  ): Promise<string> {
    const systemPrompt = `
      You are the meeting moderator deciding who should speak next.
      
      Current agenda item: "${this.agenda[this.currentAgendaItem]}"
      
      Review the recent conversation and decide which participant should speak next.
      Consider:
      - Who has relevant expertise for the current topic
      - Who hasn't spoken recently and might have valuable input
      - The natural flow of conversation
      ${lastSpeakerId ? `- Do NOT select ${agents[lastSpeakerId].name} who just spoke` : ''}
      
      Return ONLY the ID of the agent who should speak next, nothing else.
    `;

    // Get the last portion of the conversation
    const recentMessages = conversation.slice(-Math.min(10, conversation.length));

    try {
      // If we have a lastSpeakerId, create available participants excluding that agent
      const availableParticipants: Record<string, string> = {};
      for (const [id, agent] of Object.entries(agents)) {
        if (id !== 'moderator' && id !== lastSpeakerId) {
          availableParticipants[id] = agent.name;
        }
      }

      // If we somehow have no available participants (shouldn't happen), return random
      if (Object.keys(availableParticipants).length === 0) {
        const agentIds = Object.keys(agents).filter((id) => id !== 'moderator' && id !== lastSpeakerId);
        if (agentIds.length === 0) {
          // Fallback if we somehow have only the moderator and last speaker
          return Object.keys(agents).filter((id) => id !== 'moderator')[0];
        }
        return agentIds[Math.floor(Math.random() * agentIds.length)];
      }

      const response = await this.client.messages.create({
        model: this.lowEndModel,
        max_tokens: 50,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `
              Recent conversation:
              ${JSON.stringify(
                recentMessages.map((m) => ({
                  agent: m.agentId,
                  content: m.content,
                })),
                null,
                2,
              )}
              
              Available participants:
              ${JSON.stringify(availableParticipants, null, 2)}
              
              Who should speak next? Respond with only their agent_id.
            `,
          },
        ],
      });

      let nextSpeaker = 'tbd';
      const last = response.content[response.content.length - 1];
      if (last.type === 'text') {
        nextSpeaker = last.text.trim();
      }

      // Clean up response to just get the agent ID
      if (!agents[nextSpeaker]) {
        // Try to extract just the ID if the model added explanation
        const idMatch = nextSpeaker.match(/([a-z_]+)/);
        if (idMatch) {
          nextSpeaker = idMatch[1];
        }
      }

      // Make sure we didn't select the lastSpeakerId
      if (nextSpeaker === lastSpeakerId) {
        // If somehow the model returned the last speaker, select someone else
        const eligibleAgents = Object.keys(agents).filter((id) => id !== 'moderator' && id !== lastSpeakerId);
        nextSpeaker = eligibleAgents[Math.floor(Math.random() * eligibleAgents.length)];
      }

      if (agents[nextSpeaker]) {
        return nextSpeaker;
      }
      // Fallback: choose someone who hasn't spoken recently and is not the last speaker
      const agentIds = Object.keys(agents).filter((id) => id !== 'moderator' && id !== lastSpeakerId);
      return agentIds[Math.floor(Math.random() * agentIds.length)];
    } catch (error: unknown) {
      console.error('Error choosing next speaker:', error);

      // Random fallback avoiding the last speaker
      const agentIds = Object.keys(agents).filter((id) => id !== 'moderator' && id !== lastSpeakerId);
      if (agentIds.length === 0) {
        // If we have no eligible agents (shouldn't happen), just pick any non-moderator
        return Object.keys(agents).filter((id) => id !== 'moderator')[0];
      }
      return agentIds[Math.floor(Math.random() * agentIds.length)];
    }
  }

  /**
   * Determine if it's time to move to the next agenda item
   */
  async shouldMoveToNextAgendaItem(conversation: Message[]): Promise<boolean> {
    const systemPrompt = `
      You are the meeting moderator deciding if it's time to move to the next agenda item.
      
      Current agenda item: "${this.agenda[this.currentAgendaItem]}"
      
      Review the recent conversation and decide if the current agenda item has been sufficiently discussed.
      Consider:
      - Have the key points been covered?
      - Has the discussion started going in circles?
      - Has a conclusion or decision been reached?
      - Have all relevant participants had a chance to contribute?
      
      Return ONLY "YES" if it's time to move on, or "NO" if more discussion is needed.
    `;

    // Get messages relevant to the current agenda item
    const currentItemMessages: Message[] = [];
    let foundStart = false;

    for (const message of conversation) {
      if (
        !foundStart &&
        message.agentId === 'moderator' &&
        message.content.includes(this.agenda[this.currentAgendaItem])
      ) {
        foundStart = true;
      }

      if (foundStart) {
        currentItemMessages.push(message);
      }
    }

    // Only consider moving on if we've had a reasonable discussion
    if (currentItemMessages.length < 5) {
      return false;
    }
    // Alright...that's plenty
    if (currentItemMessages.length >= 10) {
      return true;
    }

    try {
      const response = await this.client.messages.create({
        model: this.lowEndModel,
        max_tokens: 10,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Recent discussion:\n${currentItemMessages
              .slice(-10)
              .map((m) => `${m.agentId || 'User'}: ${m.content}`)
              .join('\n')}`,
          },
        ],
      });

      const last = response.content[response.content.length - 1];
      if (last.type === 'text') {
        return last.text.trim().toUpperCase().includes('YES');
      }
      return false;
    } catch (error: unknown) {
      console.error('Error deciding on agenda progression:', error);
      // Default to continuing the current item
      return false;
    }
  }
}
