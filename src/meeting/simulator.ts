/**
 * Meeting Simulator class
 */

import chalk from 'chalk';
import Enquirer from 'enquirer';
import ora from 'ora';
// Access Input class dynamically
// biome-ignore lint/suspicious/noExplicitAny: Enquirer doesn't have proper types
const Input = (Enquirer as any).Input;

import type Anthropic from '@anthropic-ai/sdk';
import { Agent } from '../agents/agent.js';
import { ModeratorAgent } from '../agents/moderator.js';
import type { MessageParams } from '../api/client.js';
import { createIntroductionPrompt } from '../api/prompts.js';
import { createStreamingMessage } from '../api/streaming.js';
import { type MeetingSimulatorOptions, Message, type PersonaDirectory, type PersonaInfo } from '../types.js';
import { displaySectionHeader } from '../ui/messaging.js';
import { createSpinner } from '../ui/spinner.js';
import { createStatusUpdater } from '../ui/status.js';
import { debugLog, sleep } from '../utils/index.js';
import { ConversationManager } from './conversation.js';
import { selectNextSpeaker } from './speaker.js';
import { saveTranscript as saveTranscriptToFile } from './transcript.js';

/**
 * Class for simulating a meeting with AI agents
 */
export class MeetingSimulator {
  client: Anthropic;
  agenda: string[];
  userInvolvement: string;
  lowEndModel: string;
  highEndModel: string;
  meetingPurpose: string;
  meetingPhase: 'setup' | 'introductions' | 'discussion' | 'conclusion';
  lastNonModeratorSpeaker: string | null;
  availablePersonas: PersonaDirectory;
  agents: Record<string, Agent>;
  moderator: ModeratorAgent | null;
  conversationManager: ConversationManager;

  /**
   * Create a new meeting simulator
   */
  constructor({
    client,
    agenda,
    userInvolvement = 'low',
    lowEndModel = 'claude-3-haiku-20240307',
    highEndModel = 'claude-3-sonnet-20240229',
    meetingPurpose = 'Weekly team meeting',
  }: MeetingSimulatorOptions) {
    this.client = client;
    this.agenda = agenda;
    this.userInvolvement = userInvolvement;
    this.lowEndModel = lowEndModel;
    this.highEndModel = highEndModel;
    this.meetingPurpose = meetingPurpose;

    // Meeting state management
    this.meetingPhase = 'setup'; // Possible values: setup, introductions, discussion, conclusion
    this.lastNonModeratorSpeaker = null;

    // Import personas from the external module
    this.availablePersonas = {};
    this.agents = {};
    this.moderator = null;
    this.conversationManager = new ConversationManager({});
  }

  /**
   * Initialize the meeting simulator
   */
  async initialize(
    statusCallback: ((message: string) => void) | null = null,
    personaSelectionCallback:
      | ((
          recommendedPersonas: Record<string, PersonaInfo>,
          availablePersonas: PersonaDirectory,
        ) => Promise<Record<string, PersonaInfo>>)
      | null = null,
  ): Promise<void> {
    // Create status updater function
    const updateStatus = createStatusUpdater(statusCallback);

    // Import personas dynamically to avoid circular dependencies
    updateStatus('Loading personas library...');
    await sleep(300); // Small pause to show status
    const { availablePersonas } = await import('../personas.js');
    this.availablePersonas = availablePersonas;

    // Initialize moderator
    updateStatus('Initializing meeting moderator...');
    await sleep(300); // Small pause to show status
    this.moderator = new ModeratorAgent({
      client: this.client,
      agenda: this.agenda,
      availablePersonas: this.availablePersonas,
      lowEndModel: this.lowEndModel,
      highEndModel: this.highEndModel,
      meetingPurpose: this.meetingPurpose,
    });

    // Pre-select personas based on the meeting agenda
    updateStatus('Recommending meeting participants based on topic...');
    const recommendedPersonas = await this.moderator.selectParticipants();

    // Allow user to customize participant selection if callback is provided
    let finalSelectedPersonas = recommendedPersonas;
    if (personaSelectionCallback && typeof personaSelectionCallback === 'function') {
      updateStatus('Waiting for user to finalize participant selection...');
      finalSelectedPersonas = await personaSelectionCallback(recommendedPersonas, this.availablePersonas);
    }

    const participantCount = Object.keys(finalSelectedPersonas).length;
    updateStatus(`Finalizing ${participantCount} participants for the meeting...`);

    updateStatus('Configuring participant personas and creating agent profiles...');
    await sleep(300); // Small pause to show status

    // Initialize agent objects
    this.agents = await this._initializeAgents(finalSelectedPersonas, statusCallback);

    // Add moderator to agents
    updateStatus('Adding moderator to meeting roster...');
    await sleep(300); // Small pause to show status
    if (this.moderator) {
      this.agents.moderator = this.moderator;
    }

    // Initialize conversation manager with the agents
    this.conversationManager = new ConversationManager(this.agents);

    // Final setup
    updateStatus('Preparing meeting context and history...');
  }

  /**
   * Initialize Agent objects for selected personas
   */
  async _initializeAgents(
    selectedPersonas: Record<string, PersonaInfo>,
    statusCallback: ((message: string) => void) | null = null,
  ): Promise<Record<string, Agent>> {
    const agents: Record<string, Agent> = {};
    const personaCount = Object.keys(selectedPersonas).length;
    let currentPersona = 0;

    for (const [agentId, personaInfo] of Object.entries(selectedPersonas)) {
      currentPersona++;

      agents[agentId] = new Agent({
        agentId,
        name: personaInfo.name,
        persona: personaInfo.persona,
        role: personaInfo.role,
        color: personaInfo.color,
        client: this.client,
        lowEndModel: this.lowEndModel,
        highEndModel: this.highEndModel,
      });

      // Update overall status via debugLog
      debugLog(`Setting up ${personaInfo.name} [${personaInfo.role}] (${currentPersona}/${personaCount})`);
    }

    return agents;
  }

  /**
   * Introduce all participants at the start of the meeting
   * Each introduction is generated and shown in real-time, one at a time
   */
  async introduceParticipants(): Promise<void> {
    // Update meeting phase to introductions
    this.meetingPhase = 'introductions';
    debugLog(`Meeting phase changed to: ${this.meetingPhase}`);

    // Introduce moderator first
    if (this.moderator) {
      // Create spinner for the moderator introduction
      const introSpinner = createSpinner(
        `✋ ${this.moderator.color.bold(this.moderator.name)} is preparing an introduction...`,
      ).start();

      // Generate the introduction
      const moderatorIntro = await this.moderator.generateIntroduction();

      // Stop spinner and display introduction
      introSpinner.stop();
      this.moderator.printMessage(moderatorIntro);
      this.conversationManager.addMessage('assistant', moderatorIntro, 'moderator');

      // Brief pause after moderator speaks
      await sleep(1000);
    }

    // Introduce other participants one by one with streaming
    for (const [agentId, agent] of Object.entries(this.agents)) {
      if (agentId !== 'moderator') {
        // Create spinner for agent introduction
        const introSpinner = createSpinner(
          `✋ ${agent.color.bold(agent.name)} is preparing an introduction...`,
        ).start();

        // Flag to track if we've received the first chunk
        let receivedFirstChunk = false;

        // Define a streaming callback function that will be called for each chunk
        const streamCallback = (chunk: string) => {
          // If this is the first chunk, stop the spinner and start streaming
          if (!receivedFirstChunk) {
            introSpinner.stop();
            receivedFirstChunk = true;
            // Print first chunk with the agent's name and role prefix
            agent.printMessage(chunk, true, true);
          } else {
            // Print subsequent chunks without the prefix
            agent.printMessage(chunk, true, false);
          }
        };

        try {
          // System prompt for introduction
          const systemPrompt = createIntroductionPrompt(agent.name, agent.persona);

          // Set up API parameters
          const messageParams: MessageParams = {
            model: agent.lowEndModel,
            max_tokens: 150,
            stream: true,
            system: systemPrompt,
            messages: [{ role: 'user', content: 'Please introduce yourself briefly.' }],
          };

          // Generate the introduction with streaming
          const intro = await createStreamingMessage(
            agent.client,
            messageParams,
            streamCallback,
            agent.name,
            agent.role,
          );

          // If we didn't receive any chunks, display normally
          if (!receivedFirstChunk) {
            introSpinner.stop();
            agent.printMessage(intro);
          } else {
            // If we were streaming, complete the message
            agent.completeStreamedMessage();
          }

          // Store the introduction for later reference
          agent.introduction = intro;

          // Add message to conversation history
          this.conversationManager.addMessage('assistant', intro, agentId);

          // Update last speaker
          this.lastNonModeratorSpeaker = agentId;

          // Brief pause between introductions
          await sleep(1000);
        } catch (error: unknown) {
          // Handle errors
          introSpinner.stop();
          console.error(`Error generating introduction for ${agent.name}:`, error);
          const fallbackIntro = `Hello, I'm ${agent.name}. [Error generating introduction: ${error instanceof Error ? error.message : 'unknown cause'}]`;
          agent.introduction = fallbackIntro;
          agent.printMessage(fallbackIntro);
          this.conversationManager.addMessage('assistant', fallbackIntro, agentId);

          // Brief pause after error
          await sleep(500);
        }
      }
    }
  }

  /**
   * Run the simulated meeting
   */
  async runMeeting(): Promise<void> {
    if (!this.moderator) {
      throw new Error('Moderator not initialized');
    }

    // Start the meeting - transitions from introductions to discussion phase
    const startMessage = await this.moderator.startMeeting();
    this.moderator.printMessage(startMessage);
    this.conversationManager.addMessage('assistant', startMessage, 'moderator');

    // Update meeting phase to discussion
    this.meetingPhase = 'discussion';
    debugLog(`Meeting phase changed to: ${this.meetingPhase}`);
    // Clear the last speaker at the start of the discussion phase
    this.lastNonModeratorSpeaker = null;

    const meetingActive = true;
    let turnsSinceUserInput = 0;

    while (meetingActive) {
      // Check if user should be given a chance to speak based on involvement level
      let userTurn = false;

      if (this.userInvolvement === 'high') {
        userTurn = turnsSinceUserInput >= 3;
      } else if (this.userInvolvement === 'low') {
        userTurn = turnsSinceUserInput >= 6;
      }

      if (userTurn) {
        console.log(chalk.cyan('\n🎯 Your turn to speak:'));
        const userInput = await new Input({
          name: 'input',
          message: chalk.cyanBright.bold('💬 You:'),
          initial: '',
        }).run();

        if (['exit', 'quit', 'end meeting'].includes(userInput.toLowerCase())) {
          await this.endMeetingEarly();
          break;
        }

        this.conversationManager.addMessage('user', userInput);
        turnsSinceUserInput = 0;
      } else if (meetingActive) {
        // Check if the meeting is still active before proceeding
        // Check if we should move to the next agenda item
        const shouldMoveNext = await this.moderator.shouldMoveToNextAgendaItem(
          this.conversationManager.getAllMessages(),
        );

        if (shouldMoveNext) {
          const nextItem = await this.moderator.nextAgendaItem(this.conversationManager.getAllMessages());

          if (nextItem === null) {
            // End of meeting
            await this.concludeMeeting();
            break;
          }

          this.moderator.printMessage(nextItem);
          this.conversationManager.addMessage('assistant', nextItem, 'moderator');
          turnsSinceUserInput += 1;
          continue;
        }

        // Double-check that the meeting is still active before calculating urgencies
        // This is a safety measure in case meetingActive was set to false elsewhere
        if (!meetingActive) {
          break;
        }

        // Get the current agenda item
        const currentAgendaItem = this.agenda[this.moderator.currentAgendaItem];
        const recentMessages = this.conversationManager.getRecentMessages(10);

        // Check if the last message was from a user
        const lastMessageWasUserInput = this.conversationManager.isLastMessageFromUser();

        // Select the next speaker
        const nextSpeaker = await selectNextSpeaker(
          this.agents,
          recentMessages,
          this.lastNonModeratorSpeaker,
          this.moderator,
          currentAgendaItem,
          lastMessageWasUserInput,
        );

        // Generate the selected agent's response with interruption possibility
        await this.generateAgentResponse(nextSpeaker, turnsSinceUserInput);
        turnsSinceUserInput += 1;
      }

      // Brief pause between turns for readability
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  /**
   * Generate and display a response from an agent, with interruption possibility
   */
  async generateAgentResponse(agentId: string, turnsSinceUserInput: number): Promise<boolean> {
    // Set up a flag to track if we've been interrupted
    let interrupted = false;

    // Get the agent
    const agent = this.agents[agentId];

    // Set up interrupt handler for SIGINT (Ctrl+C)
    const originalSigIntHandler = process.listeners('SIGINT').pop();
    if (originalSigIntHandler) {
      process.removeListener('SIGINT', originalSigIntHandler);
    }

    // Add our custom handler
    const sigintHandler = () => {
      interrupted = true;
      responseSpinner.stop();
      console.log(chalk.yellowBright('\n🙋 You raised your hand to interrupt!'));
    };
    process.on('SIGINT', sigintHandler);

    // Spinner for the speaking agent with interrupt instructions
    const responseSpinner = createSpinner(
      `✋ ${agent.color.bold(agent.name)} is composing a response... (^C to interrupt)`,
    ).start();

    // Log that we're generating a response
    debugLog(`Generating response for ${agent.name} [${agent.role}]`);

    // Flag to track if we've received the first chunk
    let receivedFirstChunk = false;

    // Define a streaming callback function that will be called for each chunk
    const streamCallback = (chunk: string) => {
      // If this is the first chunk, stop the spinner and start streaming
      if (!receivedFirstChunk) {
        responseSpinner.stop();
        receivedFirstChunk = true;
        // Print first chunk with the agent's name and role prefix
        agent.printMessage(chunk, true, true);
      } else {
        // Print subsequent chunks without the prefix
        agent.printMessage(chunk, true, false);
      }
    };

    // Start response generation with streaming
    const responsePromise = agent.generateResponse(this.conversationManager.getAllMessages(), streamCallback);

    // Wait for either response completion or interruption
    const response = await responsePromise.catch((error) => {
      console.error(`Error generating response: ${error.message}`);
      return `[Error generating response: ${error.message}]`;
    });

    // Only proceed with displaying the response if not interrupted
    if (!interrupted) {
      // If we didn't receive any chunks yet (possibly API didn't stream),
      // or if streaming failed, display the response normally
      if (!receivedFirstChunk) {
        responseSpinner.stop();
        agent.printMessage(response);
      } else {
        // If we were streaming, complete the message
        agent.completeStreamedMessage();
      }

      // Add the message to the conversation
      this.conversationManager.addMessage('assistant', response, agentId);

      // Update last non-moderator speaker for the next round
      if (agentId !== 'moderator') {
        this.lastNonModeratorSpeaker = agentId;
        debugLog(`Updated last non-moderator speaker to: ${this.agents[agentId].name}`);
      }
    } else {
      // User interrupted, let them speak
      const userInput = await new Input({
        name: 'input',
        message: chalk.yellowBright.bold('🙋 You:'),
        initial: '',
      }).run();

      if (['exit', 'quit', 'end meeting'].includes(userInput.toLowerCase())) {
        await this.endMeetingEarly();
        return true; // Return true to indicate meeting was ended
      }
      this.conversationManager.addMessage('user', userInput);
    }

    // Restore original SIGINT handler
    process.removeListener('SIGINT', sigintHandler);
    if (originalSigIntHandler) {
      process.on('SIGINT', originalSigIntHandler);
    }

    return false; // Return false to indicate meeting continues
  }

  /**
   * End the meeting early (user requested)
   */
  async endMeetingEarly(): Promise<void> {
    displaySectionHeader('                Ending Meeting Early                ');

    const conclusionSpinner = createSpinner('The moderator is preparing meeting summary...', 'cyan').start();

    // Generate the meeting conclusion
    const endMessage = (await this.moderator?.endMeeting(this.conversationManager.getAllMessages())) || 'endmessage';

    // Stop spinner and display conclusion
    conclusionSpinner.succeed('Meeting summary ready');
    console.log(); // Add an empty line for spacing
    this.moderator?.printMessage(endMessage);
    this.conversationManager.addMessage('assistant', endMessage, 'moderator');

    // Update meeting phase and mark as inactive
    this.meetingPhase = 'conclusion';
    debugLog(`Meeting phase changed to: ${this.meetingPhase}`);

    displaySectionHeader('                Meeting Adjourned                   ');
  }

  /**
   * Conclude the meeting (reached end of agenda)
   */
  async concludeMeeting(): Promise<void> {
    displaySectionHeader('              Concluding Meeting                  ');

    const conclusionSpinner = createSpinner('The moderator is preparing meeting summary...', 'cyan').start();

    // Generate the meeting conclusion
    const conclusionMessage =
      (await this.moderator?.endMeeting(this.conversationManager.getAllMessages())) || 'conclusionmessage';

    // Stop spinner and display conclusion
    conclusionSpinner.succeed('Meeting summary ready');
    console.log(); // Add an empty line for spacing
    this.moderator?.printMessage(conclusionMessage);
    this.conversationManager.addMessage('assistant', conclusionMessage, 'moderator');

    // Update meeting phase
    this.meetingPhase = 'conclusion';
    debugLog(`Meeting phase changed to: ${this.meetingPhase}`);

    displaySectionHeader('                Meeting Adjourned                   ');
  }

  /**
   * Save the meeting transcript to a Markdown file
   */
  async saveTranscript(filename: string): Promise<void> {
    if (!this.moderator) {
      throw new Error('Moderator not initialized');
    }

    return saveTranscriptToFile(
      filename,
      this.conversationManager.getAllMessages(),
      this.moderator,
      this.agents,
      this.meetingPurpose,
      this.agenda,
    );
  }
}
