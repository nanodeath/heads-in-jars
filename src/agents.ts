import chalk, { type ChalkInstance } from 'chalk';
import type { AnthropicClient, MessageParam } from './api/client.js';
import {
  createAgendaTransitionPrompt,
  createIntroductionPrompt,
  createMeetingConclusionPrompt,
  createMeetingStartPrompt,
  createResponsePrompt,
  createUrgencyPrompt,
} from './api/prompts.js';
import type { AgentOptions, Message, ModeratorOptions, PersonaDirectory, PersonaInfo, TokenUsage } from './types.js';
import { calculateCost, withRetryLogic } from './utils.js';
import { debugLog } from './utils/index.js';

/**
 * Base class for AI agents
 */
export class Agent {
  agentId: string;
  name: string;
  persona: string;
  role: string;
  color: ChalkInstance;
  client: AnthropicClient;
  lowEndModel: string;
  highEndModel: string;
  maxTokens: number;
  messagesSinceLastSpoken: number;
  introduction: string;

  /**
   * Create a new agent
   */
  constructor({
    agentId,
    name,
    persona,
    role,
    color,
    client,
    lowEndModel = 'claude-3-haiku-20240307',
    highEndModel = 'claude-3-sonnet-20240229',
    maxTokens = 1000,
  }: AgentOptions) {
    this.agentId = agentId;
    this.name = name;
    this.persona = persona;
    this.role = role;
    this.color = color;
    this.client = client;
    this.lowEndModel = lowEndModel;
    this.highEndModel = highEndModel;
    this.maxTokens = maxTokens;
    this.messagesSinceLastSpoken = 0; // Count of messages since this agent last spoke
    this.introduction = '';
  }

  /**
   * Generate an introduction for the agent
   */
  async generateIntroduction(statusCallback: ((message: string) => void) | null = null): Promise<string> {
    // Helper function to update status if callback provided
    const updateStatus = (message: string) => {
      if (statusCallback && typeof statusCallback === 'function') {
        statusCallback(message);
      }
    };

    if (this.introduction) return this.introduction;

    updateStatus(`Generating introduction for ${this.name}...`);

    const systemPrompt = createIntroductionPrompt(this.name, this.persona);

    debugLog(`Generating introduction for ${this.name}`);

    // Log the request in debug mode
    debugLog(`Introduction API request for ${this.name}`, {
      model: this.lowEndModel,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Please introduce yourself briefly.' }],
    });

    try {
      updateStatus(`Contacting AI service for ${this.name}'s introduction...`);
      const response = await this.client.createMessage(
        {
          model: this.lowEndModel,
          max_tokens: 150,
          system: systemPrompt,
          messages: [{ role: 'user', content: 'Please introduce yourself briefly.' }],
        },
        'Getting introduction',
      );

      // Better error handling for response structure
      if (!response || !response.content || !response.content.length) {
        throw new Error('Empty response received from API');
      }

      const last = response.content[response.content.length - 1];
      const text = last.text;

      // Log the response in debug mode
      debugLog(`Introduction API response for ${this.name}`, {
        content: text,
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

      this.introduction = text;
      return this.introduction;
    } catch (error: unknown) {
      console.error(`Error generating introduction for ${this.name}:`, error);
      this.introduction = `Hello, I'm ${this.name}. [Error generating introduction: ${error instanceof Error ? error.message : error}]`;
      return this.introduction;
    }
  }

  /**
   * Calculate how urgently this agent needs to speak (1-5 scale)
   */
  async calculateUrgency(recentMessages: Message[], currentAgendaItem: string): Promise<number> {
    // Create a more structured system prompt for calculating urgency
    const systemPrompt = createUrgencyPrompt();

    debugLog(`${this.name} calculating urgency...`);

    // Extract the last 5 messages only for the recent context
    const lastFewMessages = recentMessages
      .slice(-5)
      .map((m) => `${m.agentId || 'User'}: ${m.content}`)
      .join('\n');

    // Create a structured multi-shot prompt with relevant context
    const userContent = `
MEETING CONTEXT:
- Current agenda item: "${currentAgendaItem}"
- Your role: ${this.role} (${this.name})
- Your persona: ${this.persona}

RECENT MESSAGES:
${lastFewMessages}

Based on this context, how urgently do you need to speak (1-5)?
    `.trim();

    // Log the request in debug mode
    debugLog(`Urgency API request for ${this.name}`, {
      model: this.lowEndModel,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    });

    try {
      // Use retry logic for API call
      const response = await withRetryLogic(
        // API call function
        async () => {
          const res = await this.client.createMessage(
            {
              model: this.lowEndModel,
              max_tokens: 10,
              system: systemPrompt,
              messages: [{ role: 'user', content: userContent }],
            },
            'Calculating agent response urgency',
          );

          const last = res.content[res.content.length - 1];

          return {
            text: last.text,
            usage: res.usage,
          };
        },
        // Description
        `calculating urgency for ${this.name}`,
        // Options
        {
          fallbackFn: async (error) => {
            console.error(`Using fallback for ${this.name} urgency calculation`);
            return {
              text: '3', // Default medium urgency
              usage: { input_tokens: 0, output_tokens: 0 } as TokenUsage,
            };
          },
        },
      );

      // Debug log the response
      debugLog(`Urgency API response for ${this.name}`, response);

      // Calculate and log cost estimate
      const costEstimate = calculateCost(this.lowEndModel, response.usage);
      debugLog(`💰 Cost estimate for ${this.name} urgency calculation:`, {
        model: this.lowEndModel,
        inputTokens: costEstimate.inputTokens,
        outputTokens: costEstimate.outputTokens,
        inputCost: `$${costEstimate.inputCost}`,
        outputCost: `$${costEstimate.outputCost}`,
        totalCost: `$${costEstimate.totalCost}`,
      });

      // Extract just the number from the response
      const urgencyText = response.text.trim();
      let urgency = Number.parseFloat(urgencyText) || 3.0;

      // Clamp between 1-5
      urgency = Math.max(1.0, Math.min(5.0, urgency));

      // Add message count factor - give a boost if the agent hasn't spoken in a while
      // Calculate boost based on messages since last spoken (max boost of 2.0 after 10 messages)
      const messageBoost = Math.min(2.0, Math.max(0, 0.2 * this.messagesSinceLastSpoken));

      const totalUrgency = urgency + messageBoost;

      // Log the urgency calculation
      debugLog(`${this.name} urgency calculation:`, {
        baseUrgency: urgency,
        messagesSinceLastSpoken: this.messagesSinceLastSpoken,
        messageBoost: messageBoost.toFixed(2),
        totalUrgency: totalUrgency.toFixed(2),
      });

      return totalUrgency;
    } catch (error: unknown) {
      console.error(`Error calculating urgency for ${this.name}:`, error);
      return 3.0; // Default medium urgency on error
    }
  }

  /**
   * Generate a response based on the conversation context
   */
  async generateResponse(conversation: Message[], onStream: (chunk: string) => void): Promise<string> {
    // Reset the count of messages since last spoken
    this.messagesSinceLastSpoken = 0;

    const systemPrompt = createResponsePrompt(this.name, this.persona, this.role);

    // Format conversation for the API
    const formattedMessages = conversation.map((message) => {
      // Create prefix with agent name and role if available
      let messagePrefix = '';
      if (message.agentName && message.agentRole) {
        messagePrefix = `${message.agentName} [${message.agentRole}]: `;
      } else if (message.agentId) {
        // Fall back to just the agent ID if name/role not available
        messagePrefix = `${message.agentId}: `;
      }

      // Other agents are the "user" to keep the agent from confusing identity
      return {
        role: message.agentId === this.agentId ? 'assistant' : 'user',
        content: messagePrefix + message.content,
      } satisfies MessageParam;
    });

    // Log the request in debug mode
    debugLog(`Response API request for ${this.name}`, {
      model: this.highEndModel,
      system: systemPrompt,
      messages: formattedMessages,
    });

    try {
      // Create streaming request
      const fullResponse = await this.client.createStreamingMessage(
        {
          model: this.highEndModel,
          max_tokens: this.maxTokens,
          system: systemPrompt,
          messages: formattedMessages,
        },
        (chunk) => {
          onStream(chunk);
        },
      );

      // Calculate approximate token usage for logging purposes
      // This is an approximation since we don't get actual token counts with streaming
      const approximateUsage = {
        input_tokens: formattedMessages.reduce((acc, msg) => acc + msg.content.length / 4, 0),
        output_tokens: fullResponse.length / 4,
      } as TokenUsage;

      // Log the response in debug mode
      debugLog(`Streaming response for ${this.name} completed`, {
        content: fullResponse,
        approximateUsage,
      });

      // Calculate and log approximate cost estimate
      const costEstimate = calculateCost(this.highEndModel, approximateUsage);
      debugLog(`💰 Approximate cost estimate for ${this.name} streaming response:`, {
        model: this.highEndModel,
        inputTokens: costEstimate.inputTokens,
        outputTokens: costEstimate.outputTokens,
        inputCost: `$${costEstimate.inputCost}`,
        outputCost: `$${costEstimate.outputCost}`,
        totalCost: `$${costEstimate.totalCost}`,
      });

      return fullResponse;
    } catch (error: unknown) {
      console.error(`Error generating response for ${this.name}:`, error);
      return `[Error generating response: ${error instanceof Error ? error.message : error}]`;
    }
  }

  /**
   * Print a message from this agent with appropriate formatting
   * @param content The message content to print
   * @param streaming Whether this is a streaming chunk (default: false)
   * @param isFirstChunk Whether this is the first chunk in a stream (default: false)
   */
  printMessage(content: string, streaming = false, isFirstChunk = false): void {
    // Use role directly or default to "Moderator" for the moderator
    const roleTitle = this.role || (this.agentId === 'moderator' ? 'Moderator' : this.agentId);

    // Check if the content already starts with agent name and role
    const nameRolePrefix = `${this.name} [${roleTitle}]: `;

    if (streaming) {
      // For streaming output, handle differently based on whether it's the first chunk or not
      if (isFirstChunk) {
        // For the first chunk, print the prefix
        process.stdout.write(this.color(nameRolePrefix + content));
      } else {
        // For subsequent chunks, just print the content in the same color
        process.stdout.write(this.color(content));
      }
    } else {
      // For non-streaming output, format the message properly
      let formattedMessage: string;
      if (content.startsWith(nameRolePrefix)) {
        // Content already has the prefix, just use it directly
        formattedMessage = this.color(content);
      } else {
        // Add the prefix
        formattedMessage = this.color(`${nameRolePrefix}${content}`);
      }

      console.log(formattedMessage);
      console.log(); // Add a blank line for readability
    }
  }

  /**
   * Completes a streamed message by adding a blank line
   */
  completeStreamedMessage(): void {
    console.log('\n'); // Add two blank lines for readability after a streamed message
  }
}

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
        'Recommending participants',
      );

      const last = response.content[response.content.length - 1];
      const responseText = last.text;

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

    const response = await this.client.createMessage(
      {
        model: this.highEndModel,
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: 'Please start the meeting.' }],
      },
      'Starting the meeting',
    );

    this.currentAgendaItem = 0;
    return response.content[response.content.length - 1].text;
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

    // Use retry logic for agenda item transition
    const response = await withRetryLogic(
      // API call function
      async () => {
        const res = await this.client.createMessage(
          {
            model: this.highEndModel,
            max_tokens: 350,
            system: systemPrompt,
            messages: [
              {
                role: 'user',
                content: `Discussion transcript for the previous agenda item:\n${currentItemMessages
                  .map((m) => `${m.agentId || 'User'}: ${m.content}`)
                  .join('\n')}`,
              },
            ],
          },
          'Moderator transitioning to next item',
        );

        return res.content[res.content.length - 1].text;
      },
      // Description
      `transitioning to agenda item "${this.agenda[this.currentAgendaItem]}"`,
      // Options
      {
        fallbackFn: async (error) => {
          // Create a generic transition as fallback
          const fallbackMessage = `Thank you for the discussion on "${this.agenda[this.currentAgendaItem - 1]}". Let's move on to our next agenda item: "${this.agenda[this.currentAgendaItem]}".`;

          console.log(chalk.yellow(`\n⚠️ Using fallback transition due to API error: ${error.message}`));

          return fallbackMessage;
        },
      },
    );

    return response;
  }

  /**
   * Generate a meeting conclusion message
   */
  async endMeeting(conversation: Message[]): Promise<string> {
    const systemPrompt = createMeetingConclusionPrompt(this.agenda);

    // Get the last portion of the conversation to summarize
    const recentMessages = conversation.slice(-Math.min(20, conversation.length));

    // Use retry logic for meeting conclusion
    const response = await withRetryLogic(
      // API call function
      async () => {
        const res = await this.client.createMessage(
          {
            model: this.highEndModel,
            max_tokens: 400,
            system: systemPrompt,
            messages: [
              {
                role: 'user',
                content: `Meeting transcript excerpt:\n${recentMessages
                  .map((m) => `${m.agentId || 'User'}: ${m.content}`)
                  .join('\n')}`,
              },
            ],
          },
          'Moderator concluding meeting',
        );

        return res.content[res.content.length - 1].text;
      },
      // Description
      'generating meeting conclusion',
      // Options
      {
        fallbackFn: async (error) => {
          // Create a generic conclusion as fallback
          const fallbackMessage = `Thank you everyone for your participation in today's meeting. We've covered all our agenda items and had some productive discussions. I'll follow up with a more detailed summary later, but for now, let's consider the meeting adjourned.`;

          console.log(chalk.yellow(`\n⚠️ Using fallback meeting conclusion due to API error: ${error.message}`));

          return fallbackMessage;
        },
      },
    );

    return response;
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
    // Use retry logic for meeting summary
    const response = await withRetryLogic(
      // API call function
      async () => {
        const res = await this.client.createMessage(
          {
            model: this.highEndModel,
            max_tokens: 1000,
            system: systemPrompt,
            messages: [
              {
                role: 'user',
                content: `Full meeting transcript:\n${conversation
                  .map((m) => `${m.agentId || 'User'}: ${m.content}`)
                  .join('\n')}`,
              },
            ],
          },
          'Moderator summarizing meeting',
        );

        return res.content[res.content.length - 1].text;
      },
      // Description
      'generating detailed meeting summary',
      // Options
      {
        fallbackFn: async (error) => {
          // Create a generic summary as fallback
          const fallbackMessage = `# Meeting Summary\n\nThis meeting covered our agenda items related to ${this.meetingPurpose}. The team discussed various perspectives and shared insights on each topic. Due to technical limitations, a detailed summary could not be generated, but the full transcript below captures all discussions that took place.`;

          console.log(chalk.yellow(`\n⚠️ Using fallback meeting summary due to API error: ${error.message}`));

          return fallbackMessage;
        },
      },
    );

    return response;
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

      const response = await this.client.createMessage(
        {
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
        },
        'Moderator semi-randomly picking a user',
      );

      let nextSpeaker = response.content[response.content.length - 1].text.trim();

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
      // Fallback: choose someone who is not the last speaker
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
        'Moderator deciding if we should move to next action item',
      );

      return response.content[response.content.length - 1].text.trim().toUpperCase().includes('YES');
    } catch (error: unknown) {
      console.error('Error deciding on agenda progression:', error);
      // Default to continuing the current item
      return false;
    }
  }
}
