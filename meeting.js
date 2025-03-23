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
    
    // Meeting state management
    this.meetingPhase = 'setup'; // Possible values: setup, introductions, discussion, conclusion
    this.lastNonModeratorSpeaker = null;
    
    // Import personas from the external module
    this.availablePersonas = {};
    this.agents = {};
    this.moderator = null;
  }

  /**
   * Initialize the meeting simulator
   * @param {Function} statusCallback - Callback function to update status
   * @param {Function} personaSelectionCallback - Optional callback to let the user select personas
   * @returns {Promise<void>}
   */
  async initialize(statusCallback = null, personaSelectionCallback = null) {
    // Helper function to update status if callback provided
    const updateStatus = (message) => {
      if (statusCallback && typeof statusCallback === 'function') {
        statusCallback(message);
      }
    };
    
    // Import personas dynamically to avoid circular dependencies
    updateStatus('Loading personas library...');
    await sleep(300); // Small pause to show status
    const { availablePersonas } = await import('./personas.js');
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
      meetingPurpose: this.meetingPurpose
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
    
    // Pass the status update function to the agent initialization
    this.agents = await this._initializeAgents(finalSelectedPersonas);
    
    // Add moderator to agents
    updateStatus('Adding moderator to meeting roster...');
    await sleep(300); // Small pause to show status
    this.agents['moderator'] = this.moderator;
    
    // Final setup
    updateStatus('Preparing meeting context and history...');
  }

  /**
   * Initialize Agent objects for selected personas
   * @param {Object} selectedPersonas - Selected personas for the meeting
   * @param {Function} statusCallback - Callback function to update status
   * @returns {Promise<Object>} Initialized agents
   */
  async _initializeAgents(selectedPersonas) {
    const agents = {};
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
        highEndModel: this.highEndModel
      });
      
      // Update overall status via debugLog
      debugLog(`Setting up ${personaInfo.name} [${personaInfo.role}] (${currentPersona}/${personaCount})`);
      
      // Pre-generate introductions with status updates
      await agents[agentId].generateIntroduction((introStatus) => {
        debugLog(`${personaInfo.name}: ${introStatus}`);
      });
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
    let agentName = null;
    let agentRole = null;
    
    // If this is an agent message, include name and role
    if (role === 'assistant' && agentId && this.agents[agentId]) {
      const agent = this.agents[agentId];
      agentName = agent.name;
      agentRole = agent.role;
    }
    
    const message = createMessage(role, content, agentId, agentName, agentRole);
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
    // Update meeting phase to introductions
    this.meetingPhase = 'introductions';
    debugLog(`Meeting phase changed to: ${this.meetingPhase}`);
    
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
        // Store the last speaker but don't enforce consecutive speaking rule during introductions
        this.lastNonModeratorSpeaker = agentId;
      }
    }
  }

  /**
   * Run the simulated meeting
   * @returns {Promise<void>}
   */
  async runMeeting() {
    // Start the meeting - transitions from introductions to discussion phase
    const startMessage = await this.moderator.startMeeting();
    this.moderator.printMessage(startMessage);
    this._addMessage('assistant', startMessage, 'moderator');
    
    // Update meeting phase to discussion
    this.meetingPhase = 'discussion';
    debugLog(`Meeting phase changed to: ${this.meetingPhase}`);
    // Clear the last speaker at the start of the discussion phase
    this.lastNonModeratorSpeaker = null;
    
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
        console.log(chalk.cyan('\n🎯 Your turn to speak:'));
        const userInput = await new Input({
          name: 'input',
          message: chalk.cyanBright.bold('💬 You:'),
          initial: '',
        }).run();
        
        if (['exit', 'quit', 'end meeting'].includes(userInput.toLowerCase())) {
          console.log(chalk.cyan('\n=== Ending Meeting Early ===\n'));
          const conclusionSpinner = ora({
            text: 'The moderator is preparing meeting summary...',
            color: 'cyan'
          }).start();
          
          // Generate the meeting conclusion
          const endMessage = await this.moderator.endMeeting(this.conversation);
          
          // Stop spinner and display conclusion
          conclusionSpinner.succeed('Meeting summary ready');
          console.log(); // Add an empty line for spacing
          this.moderator.printMessage(endMessage);
          this._addMessage('assistant', endMessage, 'moderator');
          
          // Mark meeting as inactive and exit the loop
          meetingActive = false;
          console.log(chalk.cyan('\n=== Meeting Adjourned ===\n'));
          break;
        }
        
        this._addMessage('user', userInput);
        turnsSinceUserInput = 0;
      } else if (meetingActive) { // Check if the meeting is still active before proceeding
        // Check if we should move to the next agenda item
        const shouldMoveNext = await this.moderator.shouldMoveToNextAgendaItem(this.conversation);
        
        if (shouldMoveNext) {
          const nextItem = await this.moderator.nextAgendaItem(this.conversation);
          
          if (nextItem === null) {
            // End of meeting - show feedback with spinner
            console.log(chalk.cyan('\n=== Concluding Meeting ===\n'));
            const conclusionSpinner = ora({
              text: 'The moderator is preparing meeting summary...',
              color: 'cyan'
            }).start();
            
            // Generate the meeting conclusion
            const conclusionMessage = await this.moderator.endMeeting(this.conversation);
            
            // Stop spinner and display conclusion
            conclusionSpinner.succeed('Meeting summary ready');
            console.log(); // Add an empty line for spacing
            this.moderator.printMessage(conclusionMessage);
            this._addMessage('assistant', conclusionMessage, 'moderator');
            
            // Update meeting phase and mark as inactive
            this.meetingPhase = 'conclusion';
            debugLog(`Meeting phase changed to: ${this.meetingPhase}`);
            meetingActive = false;
            console.log(chalk.cyan('\n=== Meeting Adjourned ===\n'));
            break;
          }
          
          this.moderator.printMessage(nextItem);
          this._addMessage('assistant', nextItem, 'moderator');
          turnsSinceUserInput += 1;
          continue;
        }
        
        // Double-check that the meeting is still active before calculating urgencies
        // This is a safety measure in case meetingActive was set to false elsewhere
        if (!meetingActive) {
          break;
        }
        
        // Calculate urgency scores for each agent
        const recentMessages = this._getRecentMessages(10);
        const urgencyScores = {};
        
        debugLog('Calculating urgency scores for all participants');
        
        // Get current agenda item
        const currentAgendaItem = this.agenda[this.moderator.currentAgendaItem];
        
        // Get list of participating agents (excluding moderator)
        const participantAgentIds = Object.keys(this.agents).filter(id => id !== 'moderator');
        
        // Check if the last message was from a user
        let lastMessageWasUserInput = false;
        if (this.conversation.length > 0) {
          const lastMessage = this.conversation[this.conversation.length - 1];
          if (lastMessage.role === 'user') {
            lastMessageWasUserInput = true;
            debugLog(`Last message was from user - anyone can speak next`);
          }
        }
        
        // Log meeting phase and last speaker for debugging
        debugLog(`Current meeting phase: ${this.meetingPhase}`);
        if (this.lastNonModeratorSpeaker) {
          debugLog(`Last non-moderator speaker: ${this.agents[this.lastNonModeratorSpeaker].name}`);
        } else {
          debugLog(`No previous non-moderator speaker recorded yet`);
        }
        
        // Determine who cannot speak based on meeting phase and last speaker
        let restrictedSpeakerId = null;
        
        // Only apply the consecutive speaker restriction during the discussion phase
        // and when the last message wasn't from a user
        if (this.meetingPhase === 'discussion' && !lastMessageWasUserInput && this.lastNonModeratorSpeaker) {
          restrictedSpeakerId = this.lastNonModeratorSpeaker;
          debugLog(`Restricting ${this.agents[restrictedSpeakerId].name} from speaking consecutively`);
        } else {
          debugLog(`No speaker restrictions currently active`);
        }
        
        // Create a tracking object for agent thinking status
        const thinkingStatus = {};
        participantAgentIds.forEach(id => {
          // If this is the restricted speaker, mark them as "zipped" (can't speak again)
          // Otherwise mark as "thinking" initially
          thinkingStatus[id] = (id === restrictedSpeakerId) ? "zipped" : "thinking";
        });
        
        // Helper to format the status line
        const formatStatusLine = () => {
          return `Who's next: ${participantAgentIds.map(id => {
            const agent = this.agents[id];
            let status;
            if (thinkingStatus[id] === "zipped") {
              status = "🤐"; // Zipper-mouth face for last speaker
            } else if (thinkingStatus[id] === "thinking") {
              status = "🔄"; // Thinking
            } else {
              status = "✅"; // Finished thinking
            }
            return `${agent.name} ${status}`;
          }).join(' | ')}`;
        };
        
        // Create a single spinner
        const spinner = ora({
          text: formatStatusLine(),
          color: 'cyan'
        }).start();
        
        // Collect all urgency calculation promises
        const urgencyPromises = [];
        for (const agentId of participantAgentIds) {
          // Skip urgency calculation for restricted speaker (they can't speak again immediately)
          if (agentId === restrictedSpeakerId) {
            urgencyScores[agentId] = 0; // Assign zero urgency
            continue; // Skip to next agent
          }
          
          const agent = this.agents[agentId];
          const promise = agent.calculateUrgency(recentMessages, currentAgendaItem)
            .then(urgency => {
              urgencyScores[agentId] = urgency;
              thinkingStatus[agentId] = "done"; // Mark as done
              spinner.text = formatStatusLine(); // Update spinner text
              return { agentId, urgency };
            });
          urgencyPromises.push(promise);
        }
        
        // Wait for all urgency calculations to complete
        await Promise.all(urgencyPromises);
        
        // Let moderator choose next speaker, influenced by urgency scores
        // Filter out the restricted speaker (who has zero urgency)
        const eligibleSpeakers = Object.entries(urgencyScores)
          .filter(([agentId, score]) => agentId !== restrictedSpeakerId)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3); // Top 3 most urgent
        
        let nextSpeaker;
        let speakerSelectionReason;
        
        if (Math.random() < 0.7 && eligibleSpeakers.length > 0) {
          // 70% chance to pick from top urgent speakers
          nextSpeaker = eligibleSpeakers[0][0];
          speakerSelectionReason = "highest urgency score";
        } else {
          // 30% chance to let moderator decide, but ensure we pass restrictedSpeakerId
          // so the moderator knows not to pick them again
          nextSpeaker = await this.moderator.chooseNextSpeaker(this.agents, this.conversation, restrictedSpeakerId);
          speakerSelectionReason = "moderator selection";
        }
        
        // Get the selected agent
        const selectedAgent = this.agents[nextSpeaker];
        
        // Update spinner to show final state with speaker having raised hand
        spinner.text = `Who's next: ${participantAgentIds.map(id => {
          const agent = this.agents[id];
          let status;
          
          if (id === nextSpeaker) {
            status = "✋"; // Next speaker gets raised hand emoji
          } else if (id === restrictedSpeakerId) {
            status = "🤐"; // Restricted speaker keeps zipper-mouth face
          } else {
            status = "✅"; // Others show completion checkmark
          }
          
          return `${agent.name} ${status}`;
        }).join(' | ')}`;
        
        // Brief pause to see final state
        await new Promise(resolve => setTimeout(resolve, 800));
        spinner.succeed();
        
        // Log selection reason only in debug mode
        debugLog(`Selected next speaker: ${selectedAgent.name} (${speakerSelectionReason})`);
        
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
        
        // Next speaker has already been chosen in the spinner section
        
        
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
          console.log(chalk.yellowBright('\n🙋 You raised your hand to interrupt!'));
        };
        process.on('SIGINT', sigintHandler);
        
        // Spinner for the speaking agent with interrupt instructions
        const responseSpinner = ora({
          text: `✋ ${agent.name} is composing a response... (Press Ctrl+C to interrupt)`,
          color: agent.color.replace('Bright', '') || 'white',
        }).start();
        
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
          
          // Update last non-moderator speaker for the next round
          if (nextSpeaker !== 'moderator') {
            this.lastNonModeratorSpeaker = nextSpeaker;
            debugLog(`Updated last non-moderator speaker to: ${this.agents[nextSpeaker].name}`);
          }
          
          turnsSinceUserInput += 1;
        } else {
          // User interrupted, let them speak
          const userInput = await new Input({
            name: 'input',
            message: chalk.yellowBright.bold('🙋 You:'),
            initial: '',
          }).run();
          
          if (['exit', 'quit', 'end meeting'].includes(userInput.toLowerCase())) {
            console.log(chalk.cyan('\n=== Ending Meeting Early ===\n'));
            const conclusionSpinner = ora({
              text: 'The moderator is preparing meeting summary...',
              color: 'cyan'
            }).start();
            
            // Generate the meeting conclusion
            const endMessage = await this.moderator.endMeeting(this.conversation);
            
            // Stop spinner and display conclusion
            conclusionSpinner.succeed('Meeting summary ready');
            console.log(); // Add an empty line for spacing
            this.moderator.printMessage(endMessage);
            this._addMessage('assistant', endMessage, 'moderator');
            
            // Update meeting phase and mark as inactive
            this.meetingPhase = 'conclusion';
            debugLog(`Meeting phase changed to: ${this.meetingPhase}`);
            meetingActive = false;
            console.log(chalk.cyan('\n=== Meeting Adjourned ===\n'));
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