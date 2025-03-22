import fs from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import enquirer from 'enquirer';
const { Input } = enquirer;
import { Agent, ModeratorAgent } from './agents.js';
import { createMessage, sleep, debugLog } from './utils.js';

/**
 * Class for simulating a meeting with AI agents
 */
class MeetingSimulator {
  /**
   * Create a new meeting simulator
   * @param {Object} options - Simulator options
   * @param {Object} options.client - Anthropic API client
   * @param {Array} options.agenda - Meeting agenda items
   * @param {string} options.userInvolvement - Level of user involvement (none, low, high)
   * @param {string} options.lowEndModel - Model to use for urgency calculations
   * @param {string} options.highEndModel - Model to use for main responses
   * @param {string} options.meetingPurpose - Purpose of the meeting
   */
  constructor({
    client,
    agenda,
    userInvolvement = 'low',
    lowEndModel = 'claude-3-haiku-20240307',
    highEndModel = 'claude-3-sonnet-20240229',
    meetingPurpose = 'Weekly team meeting'
  }) {
    this.client = client;
    this.agenda = agenda;
    this.userInvolvement = userInvolvement;
    this.lowEndModel = lowEndModel;
    this.highEndModel = highEndModel;
    this.meetingPurpose = meetingPurpose;
    this.conversation = [];
    
    // Import personas from the external module
    this.availablePersonas = {};
    this.agents = {};
    this.moderator = null;
  }

  /**
   * Initialize the meeting simulator
   * @returns {Promise<void>}
   */
  async initialize() {
    // Import personas dynamically to avoid circular dependencies
    const { availablePersonas } = await import('./personas.js');
    this.availablePersonas = availablePersonas;
    
    // Initialize moderator
    this.moderator = new ModeratorAgent({
      client: this.client,
      agenda: this.agenda,
      availablePersonas: this.availablePersonas,
      lowEndModel: this.lowEndModel,
      highEndModel: this.highEndModel
    });
    
    // Select and initialize participating agents
    const selectedPersonas = await this.moderator.selectParticipants();
    this.agents = await this._initializeAgents(selectedPersonas);
    
    // Add moderator to agents
    this.agents['moderator'] = this.moderator;
  }

  /**
   * Initialize Agent objects for selected personas
   * @param {Object} selectedPersonas - Selected personas for the meeting
   * @returns {Promise<Object>} Initialized agents
   */
  async _initializeAgents(selectedPersonas) {
    const agents = {};
    
    for (const [agentId, personaInfo] of Object.entries(selectedPersonas)) {
      agents[agentId] = new Agent({
        agentId,
        name: personaInfo.name,
        persona: personaInfo.persona,
        role: personaInfo.role,
        color: personaInfo.color,
        client: this.client,
        lowEndModel: this.lowEndModel,
        highEndModel: this.highEndModel
      });
      
      // Pre-generate introductions
      await agents[agentId].generateIntroduction();
    }
    
    return agents;
  }

  /**
   * Add a message to the conversation history and update message counts
   * @param {string} role - Message role ('user' or 'assistant')
   * @param {string} content - Message content
   * @param {string} agentId - Agent ID for assistant messages
   */
  _addMessage(role, content, agentId = null) {
    const message = createMessage(role, content, agentId);
    this.conversation.push(message);
    
    // Increment messagesSinceLastSpoken for all agents except the one speaking
    if (role === 'assistant' && agentId) {
      Object.entries(this.agents).forEach(([id, agent]) => {
        if (id !== agentId && id !== 'moderator') {
          agent.messagesSinceLastSpoken++;
          
          if (global.isDebugMode) {
            debugLog(`Incremented message count for ${agent.name} to ${agent.messagesSinceLastSpoken}`);
          }
        }
      });
    } else if (role === 'user') {
      // When user speaks, increment for all non-moderator agents
      Object.entries(this.agents).forEach(([id, agent]) => {
        if (id !== 'moderator') {
          agent.messagesSinceLastSpoken++;
          
          if (global.isDebugMode) {
            debugLog(`Incremented message count for ${agent.name} to ${agent.messagesSinceLastSpoken}`);
          }
        }
      });
    }
  }

  /**
   * Get the most recent messages from the conversation
   * @param {number} count - Number of messages to get
   * @returns {Array} Recent messages
   */
  _getRecentMessages(count = 10) {
    return this.conversation.slice(-Math.min(count, this.conversation.length));
  }

  /**
   * Introduce all participants at the start of the meeting
   * @returns {Promise<void>}
   */
  async introduceParticipants() {
    console.log(chalk.white.bold('=== Meeting Participants ===\n'));
    
    // Introduce moderator first
    const moderatorIntro = await this.moderator.generateIntroduction();
    this.moderator.printMessage(moderatorIntro);
    this._addMessage('assistant', moderatorIntro, 'moderator');
    
    // Introduce other participants
    for (const [agentId, agent] of Object.entries(this.agents)) {
      if (agentId !== 'moderator') {
        agent.printMessage(agent.introduction);
        this._addMessage('assistant', agent.introduction, agentId);
      }
    }
  }

  /**
   * Run the simulated meeting
   * @returns {Promise<void>}
   */
  async runMeeting() {
    // Start the meeting
    const startMessage = await this.moderator.startMeeting();
    this.moderator.printMessage(startMessage);
    this._addMessage('assistant', startMessage, 'moderator');
    
    let meetingActive = true;
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
        const userInput = await new Input({
          name: 'input',
          message: chalk.white.bold('You:'),
          initial: '',
        }).run();
        
        if (['exit', 'quit', 'end meeting'].includes(userInput.toLowerCase())) {
          console.log(chalk.white.bold('\n=== Ending Meeting Early ===\n'));
          const endMessage = await this.moderator.endMeeting(this.conversation);
          this.moderator.printMessage(endMessage);
          this._addMessage('assistant', endMessage, 'moderator');
          break;
        }
        
        this._addMessage('user', userInput);
        turnsSinceUserInput = 0;
      } else {
        // Check if we should move to the next agenda item
        const shouldMoveNext = await this.moderator.shouldMoveToNextAgendaItem(this.conversation);
        
        if (shouldMoveNext) {
          const nextItem = await this.moderator.nextAgendaItem(this.conversation);
          
          if (nextItem === null) {
            // End of meeting
            meetingActive = false;
            break;
          }
          
          this.moderator.printMessage(nextItem);
          this._addMessage('assistant', nextItem, 'moderator');
          turnsSinceUserInput += 1;
          continue;
        }
        
        // Calculate urgency scores for each agent
        const recentMessages = this._getRecentMessages(10);
        const urgencyScores = {};
        const urgencySpinner = ora('Agents considering responses...').start();
        
        debugLog('Calculating urgency scores for all participants');
        
        // Get current agenda item
        const currentAgendaItem = this.agenda[this.moderator.currentAgendaItem];
        
        // Collect all urgency calculation promises
        const urgencyPromises = [];
        for (const [agentId, agent] of Object.entries(this.agents)) {
          if (agentId !== 'moderator') {
            const promise = agent.calculateUrgency(recentMessages, currentAgendaItem)
              .then(urgency => {
                urgencyScores[agentId] = urgency;
                return { agentId, urgency };
              });
            urgencyPromises.push(promise);
          }
        }
        
        // Wait for all urgency calculations to complete
        const urgencyResults = await Promise.all(urgencyPromises);
        
        urgencySpinner.stop();
        
        // Display urgency scores in debug mode
        if (global.isDebugMode) {
          console.log(chalk.gray('=== Urgency Scores ==='));
          
          // Sort by urgency score (highest first)
          const sortedScores = Object.entries(urgencyScores)
            .sort((a, b) => b[1] - a[1]);
          
          for (const [agentId, score] of sortedScores) {
            const agent = this.agents[agentId];
            // Display each agent's urgency score with formatting based on how urgent it is
            const scoreColor = score >= 4 ? 'redBright' : 
                           score >= 3 ? 'yellowBright' : 'greenBright';
            console.log(chalk.gray(`${agent.name} [${agent.role}]: `) + 
                        chalk[scoreColor](`${score.toFixed(2)}`));
          }
          console.log(chalk.gray('====================='));
        }
        
        // Let moderator choose next speaker, influenced by urgency scores
        const nextSpeakerSuggestions = Object.entries(urgencyScores)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3); // Top 3 most urgent
        
        let nextSpeaker;
        let speakerSelectionReason;
        
        if (Math.random() < 0.7 && nextSpeakerSuggestions.length > 0) {
          // 70% chance to pick from top urgent speakers
          nextSpeaker = nextSpeakerSuggestions[0][0];
          speakerSelectionReason = "highest urgency score";
        } else {
          // 30% chance to let moderator decide completely
          nextSpeaker = await this.moderator.chooseNextSpeaker(this.agents, this.conversation);
          speakerSelectionReason = "moderator selection";
        }
        
        // Log how the next speaker was selected
        debugLog(`Selected next speaker: ${this.agents[nextSpeaker].name} (${speakerSelectionReason})`);
        
        
        // Generate the chosen agent's response with interruption possibility
        const agent = this.agents[nextSpeaker];
        
        // Set up a flag to track if we've been interrupted
        let interrupted = false;
        
        // Set up interrupt handler for SIGINT (Ctrl+C)
        const originalSigIntHandler = process.listeners('SIGINT').pop();
        if (originalSigIntHandler) {
          process.removeListener('SIGINT', originalSigIntHandler);
        }
        
        // Add our custom handler
        const sigintHandler = () => {
          interrupted = true;
          responseSpinner.stop();
          console.log(chalk.yellow('\nInterrupted! Your turn to speak.'));
        };
        process.on('SIGINT', sigintHandler);
        
        // Start the spinner with interrupt message
        const responseSpinner = ora(`${agent.name} is thinking...press ^C to interrupt.`).start();
        
        // Log that we're generating a response
        debugLog(`Generating response for ${agent.name} [${agent.role}]`);
        
        // Start response generation as a separate promise we can handle
        const responsePromise = agent.generateResponse(this.conversation);
        
        // Wait for either response completion or interruption
        const response = await responsePromise.catch(error => {
          console.error(`Error generating response: ${error.message}`);
          return `[Error generating response: ${error.message}]`;
        });
        
        // Only proceed with displaying the response if not interrupted
        if (!interrupted) {
          responseSpinner.stop();
          agent.printMessage(response);
          this._addMessage('assistant', response, nextSpeaker);
          turnsSinceUserInput += 1;
        } else {
          // User interrupted, let them speak
          const userInput = await new Input({
            name: 'input',
            message: chalk.white.bold('You:'),
            initial: '',
          }).run();
          
          if (['exit', 'quit', 'end meeting'].includes(userInput.toLowerCase())) {
            console.log(chalk.white.bold('\n=== Ending Meeting Early ===\n'));
            const endMessage = await this.moderator.endMeeting(this.conversation);
            this.moderator.printMessage(endMessage);
            this._addMessage('assistant', endMessage, 'moderator');
            meetingActive = false;
          } else {
            this._addMessage('user', userInput);
            turnsSinceUserInput = 0;
          }
        }
        
        // Restore original SIGINT handler
        process.removeListener('SIGINT', sigintHandler);
        if (originalSigIntHandler) {
          process.on('SIGINT', originalSigIntHandler);
        }
      }
      
      // Brief pause between turns for readability
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  /**
   * Save the meeting transcript to a file
   * @param {string} filename - Output filename
   */
  saveTranscript(filename) {
    const transcript = {
      meetingPurpose: this.meetingPurpose,
      agenda: this.agenda,
      participants: Object.fromEntries(
        Object.entries(this.agents).map(([id, agent]) => [
          id, 
          { 
            name: agent.name, 
            persona: agent.persona 
          }
        ])
      ),
      conversation: this.conversation.map(msg => ({
        role: msg.role,
        content: msg.content,
        agentId: msg.agentId,
        timestamp: msg.timestamp
      }))
    };
    
    fs.writeFileSync(filename, JSON.stringify(transcript, null, 2));
  }
}

export { MeetingSimulator };