/**
 * Moderator Agent for managing the meeting
 */

import chalk from 'chalk';
import type { MessageParams } from '../api/index.js';
import {
  createAgendaProgressionPrompt,
  createAgendaTransitionPrompt,
  createIntroductionPrompt,
  createMeetingConclusionPrompt,
  createMeetingStartPrompt,
  createMeetingSummaryPrompt,
  createParticipantSelectionPrompt,
} from '../api/prompts.js';
import type { Message, ModeratorOptions, PersonaDirectory, PersonaInfo, TokenUsage } from '../types.js';
import { calculateCost } from '../utils.js';
import { debugLog } from '../utils/index.js';
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
   * Generate an introduction for the agent
   */
  async generateIntroduction(statusCallback: ((message: string) => void) | null = null): Promise<string> {
    if (this.introduction) return this.introduction;

    const systemPrompt = createIntroductionPrompt(this.name, this.persona);

    debugLog(`Generating introduction for ${this.name}`);

    // Log the request in debug mode
    debugLog(`Introduction API request for ${this.name}`, {
      model: this.lowEndModel,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Please introduce yourself briefly.' }],
    });

    try {
      const messageParams: MessageParams = {
        model: this.lowEndModel,
        max_tokens: 150,
        system: systemPrompt,
        messages: [{ role: 'user', content: 'Please introduce yourself briefly.' }],
      };

      const response = await this.client.createMessage(
        messageParams,
        `generating introduction for ${this.name}`,
        `Hello, I'm ${this.name}. [Error generating introduction]`,
      );

      // Log the response in debug mode
      debugLog(`Introduction API response for ${this.name}`, {
        content: response.content[0].text,
        usage: response.usage,
      });

      // Calculate and log cost estimate
      const costEstimate = calculateCost(this.lowEndModel, response.usage);
      debugLog(`💰 Cost estimate for ${this.name} introduction generation:`, {
        model: this.lowEndModel,
        inputTokens: costEstimate.inputTokens,
        outputTokens: costEstimate.outputTokens,
        inputCost: `$${costEstimate.inputCost}`,
        outputCost: `$${costEstimate.outputCost}`,
        totalCost: `$${costEstimate.totalCost}`,
      });

      this.introduction = response.content[0].text;
      return this.introduction;
    } catch (error: unknown) {
      console.error(`Error generating introduction for ${this.name}:`, error);
      if (error instanceof Error) {
        this.introduction = `Hello, I'm ${this.name}. [Error generating introduction: ${error.message}]`;
      }
      return this.introduction;
    }
  }

  /**
   * Select which personas should participate in the meeting based on the agenda
   */
  async selectParticipants(): Promise<Record<string, PersonaInfo>> {
    const personaDescriptions = Object.fromEntries(
      Object.entries(this.availablePersonas).map(([k, v]) => [k, v.description]),
    );
    const systemPrompt = createParticipantSelectionPrompt(this.agenda, personaDescriptions);

    try {
      const response = await this.client.createMessage(
        {
          model: this.highEndModel,
          max_tokens: 500,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: 'Select the participants for this meeting.',
            },
          ],
        },
        'Selecting participants for meeting',
      );

      // Extract JSON array from response
      const responseText = response.content[response.content.length - 1].text;

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
    };

    const response = await this.client.createMessage(
      messageParams,
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
        const res = await this.client.createMessage(
          {
            model: this.highEndModel,
            max_tokens: 350,
            system: systemPrompt,
            messages: [{ role: 'user', content: userContent }],
          },
          'Moderator agenda item transition',
        );

        // Check response validity
        if (!res || !res.content || !res.content.length) {
          throw new Error('Empty response received from API');
        }

        return {
          ...res,
          content: res.content,
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
        const res = await this.client.createMessage(
          {
            model: this.highEndModel,
            max_tokens: 400,
            system: systemPrompt,
            messages: [{ role: 'user', content: userContent }],
          },
          'Moderator meeting conclusion',
        );

        // Check response validity
        if (!res || !res.content || !res.content.length) {
          throw new Error('Empty response received from API');
        }

        return {
          ...res,
          content: res.content,
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
    const systemPrompt = createMeetingSummaryPrompt(this.meetingPurpose, this.agenda);

    // Get the entire conversation to summarize
    const userContent = `Full meeting transcript:\n${conversation
      .map((m) => `${m.agentId || 'User'}: ${m.content}`)
      .join('\n')}`;

    const fallbackMessage = `This meeting covered our agenda items related to ${this.meetingPurpose}. The team discussed various perspectives and shared insights on each topic. Due to technical limitations, a detailed summary could not be generated, but the full transcript below captures all discussions that took place.`;

    // Use retry logic for meeting summary
    const response = await withRetryLogic(
      // API call function
      async () => {
        const res = await this.client.createMessage(
          {
            model: this.highEndModel,
            max_tokens: 1000,
            system: systemPrompt,
            messages: [{ role: 'user', content: userContent }],
          },
          'Moderator meeting summary',
        );

        // Check response validity
        if (!res || !res.content || !res.content.length) {
          throw new Error('Empty response received from API');
        }

        return {
          ...res,
          content: res.content,
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
   * Determine if it's time to move to the next agenda item
   */
  async shouldMoveToNextAgendaItem(conversation: Message[]): Promise<boolean> {
    const systemPrompt = createAgendaProgressionPrompt(this.agenda[this.currentAgendaItem]);

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
      const response = await this.client.createMessage(
        {
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
        },
        'Moderator should move on',
      );

      return response.content[response.content.length - 1].text.toUpperCase().includes('YES');
    } catch (error: unknown) {
      console.error('Error deciding on agenda progression:', error);
      // Default to continuing the current item
      return false;
    }
  }
}
