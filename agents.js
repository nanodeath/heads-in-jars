import chalk from 'chalk';
import { createMessage, debugLog, calculateCost } from './utils.js';

/**
 * Base class for AI agents
 */
class Agent {
  /**
   * Create a new agent
   * @param {Object} options - Agent options
   * @param {string} options.agentId - Unique identifier for the agent
   * @param {string} options.name - Display name for the agent
   * @param {string} options.persona - Description of the agent's personality and role
   * @param {string} options.role - Short role title (e.g., "PM", "Dev") 
   * @param {string} options.color - Color for the agent's messages
   * @param {Object} options.client - Anthropic API client
   * @param {string} options.lowEndModel - Model to use for urgency calculations
   * @param {string} options.highEndModel - Model to use for main responses
   * @param {number} options.maxTokens - Maximum tokens for responses
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
    maxTokens = 1000
  }) {
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
    this.introduction = null;
  }

  /**
   * Generate an introduction for the agent
   * @returns {Promise<string>} Introduction text
   */
  async generateIntroduction() {
    if (this.introduction) return this.introduction;
    
    const systemPrompt = `
      You are ${this.name}, ${this.persona}
      Write a brief introduction of yourself in first person, explaining your role and what you bring to the meeting.
      Keep it under 100 words and make it sound natural.
    `;
    
    debugLog(`Generating introduction for ${this.name}`);
    
    // Log the request in debug mode
    debugLog(`Introduction API request for ${this.name}`, {
      model: this.lowEndModel,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Please introduce yourself briefly.' }]
    });
    
    try {
      const response = await this.client.messages.create({
        model: this.lowEndModel,
        max_tokens: 150,
        system: systemPrompt,
        messages: [
          { role: 'user', content: 'Please introduce yourself briefly.' }
        ]
      });
      
      // Better error handling for response structure
      if (!response || !response.content || !response.content.length) {
        throw new Error('Empty response received from API');
      }
      
      if (!response.content[0] || typeof response.content[0].text !== 'string') {
        throw new Error('Invalid response format from API');
      }
      
      // Log the response in debug mode
      debugLog(`Introduction API response for ${this.name}`, {
        content: response.content[0].text,
        usage: response.usage
      });
      
      // Calculate and log cost estimate
      const costEstimate = calculateCost(this.lowEndModel, response.usage);
      debugLog(`💰 Cost estimate for ${this.name} introduction generation:`, {
        model: this.lowEndModel,
        inputTokens: costEstimate.inputTokens,
        outputTokens: costEstimate.outputTokens,
        inputCost: `$${costEstimate.inputCost}`,
        outputCost: `$${costEstimate.outputCost}`,
        totalCost: `$${costEstimate.totalCost}`
      });
      
      this.introduction = response.content[0].text;
      return this.introduction;
    } catch (error) {
      console.error(`Error generating introduction for ${this.name}:`, error.message);
      this.introduction = `Hello, I'm ${this.name}. [Error generating introduction: ${error.message}]`;
      return this.introduction;
    }
  }

  /**
   * Calculate how urgently this agent needs to speak (1-5 scale)
   * @param {Array} recentMessages - Recent messages from the conversation
   * @param {string} currentAgendaItem - Current agenda item being discussed
   * @returns {Promise<number>} Urgency score
   */
  async calculateUrgency(recentMessages, currentAgendaItem) {
    // Create a more structured system prompt for calculating urgency
    const systemPrompt = `
      You are an AI assistant helping to determine how urgently a meeting participant needs to speak.
      
      Based on the context and recent messages, you will analyze whether this participant should contribute now.
      You will output ONLY a number from 1-5 representing urgency:
      
      1: No need to speak, nothing to add right now
      2: Might have something minor to contribute
      3: Have a relevant point to make when appropriate
      4: Have an important point that should be made soon
      5: Need to speak immediately on a critical matter
      
      IMPORTANT: Respond ONLY with a single number from 1-5, nothing else.
    `;
    
    debugLog(`${this.name} calculating urgency...`);
    
    // Extract the last 5 messages only for the recent context
    const lastFewMessages = recentMessages.slice(-5).map(m => 
      `${m.agentId || 'User'}: ${m.content}`
    ).join('\n');
    
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
      messages: [{ role: 'user', content: userContent }]
    });
    
    try {
      const response = await this.client.messages.create({
        model: this.lowEndModel,
        max_tokens: 10,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userContent }
        ]
      });
      
      // Better error handling for response structure
      if (!response || !response.content || !response.content.length) {
        throw new Error('Empty response received from API');
      }
      
      if (!response.content[0] || typeof response.content[0].text !== 'string') {
        throw new Error('Invalid response format from API');
      }
      
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
        totalCost: `$${costEstimate.totalCost}`
      });
      
      // Extract just the number from the response
      const urgencyText = response.content[0].text.trim();
      let urgency = parseFloat(urgencyText) || 3.0;
      
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
        totalUrgency: totalUrgency.toFixed(2)
      });
      
      return totalUrgency;
      
    } catch (error) {
      console.error(`Error calculating urgency for ${this.name}:`, error.message);
      return 3.0; // Default medium urgency on error
    }
  }

  /**
   * Generate a response based on the conversation context
   * @param {Array} conversation - Full conversation history
   * @returns {Promise<string>} Generated response
   */
  async generateResponse(conversation) {
    // Reset the count of messages since last spoken
    this.messagesSinceLastSpoken = 0;
    
    const systemPrompt = `
      You are ${this.name}, ${this.persona}.
      
      You are participating in a meeting with other AI agents. Respond in a way that's consistent with your persona.
      Keep your responses concise and to the point, focused on adding value to the discussion.
      
      Rules:
      1. You must speak ONLY as ${this.name} - DO NOT respond on behalf of other meeting participants. DO NOT include your name or role in your response.
      2. Keep your response BRIEF - no more than 2-3 short paragraphs maximum.
      3. Be focused and direct - make your point clearly without rambling.
      4. Use natural language, don't be robotic.
      5. Don't fabricate historical data or user studies.
    `;
    
    // Format conversation for the API
    const formattedMessages = conversation.map(message => {
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
        content: messagePrefix + message.content
      };
    });
    
    // Log the request in debug mode
    debugLog(`Response API request for ${this.name}`, {
      model: this.highEndModel,
      system: systemPrompt,
      messages: formattedMessages
    });
    
    try {
      const response = await this.client.messages.create({
        model: this.highEndModel,
        max_tokens: this.maxTokens,
        system: systemPrompt,
        messages: formattedMessages
      });
      
      // Better error handling for response structure
      if (!response || !response.content || !response.content.length) {
        throw new Error('Empty response received from API');
      }
      
      if (!response.content[0] || typeof response.content[0].text !== 'string') {
        throw new Error('Invalid response format from API');
      }
      
      // Log the response in debug mode
      debugLog(`Response API response for ${this.name}`, {
        content: response.content[0].text,
        usage: response.usage
      });
      
      // Calculate and log cost estimate
      const costEstimate = calculateCost(this.highEndModel, response.usage);
      debugLog(`💰 Cost estimate for ${this.name} response generation:`, {
        model: this.highEndModel,
        inputTokens: costEstimate.inputTokens,
        outputTokens: costEstimate.outputTokens,
        inputCost: `$${costEstimate.inputCost}`,
        outputCost: `$${costEstimate.outputCost}`,
        totalCost: `$${costEstimate.totalCost}`
      });
      
      return response.content[0].text;
    } catch (error) {
      console.error(`Error generating response for ${this.name}:`, error.message);
      return `[Error generating response: ${error.message}]`;
    }
  }

  /**
   * Print a message from this agent with appropriate formatting
   * @param {string} content - Message content
   */
  printMessage(content) {
    // Use role directly or default to "Moderator" for the moderator
    const roleTitle = this.role || (this.agentId === 'moderator' ? 'Moderator' : this.agentId);
    
    // Check if the content already starts with agent name and role
    const nameRolePrefix = `${this.name} [${roleTitle}]: `;
    
    // Format the message properly - avoid duplication if the prefix already exists
    let formattedMessage;
    if (content.startsWith(nameRolePrefix)) {
      // Content already has the prefix, just use it directly
      formattedMessage = chalk[this.color](content);
    } else {
      // Add the prefix
      formattedMessage = chalk[this.color](`${nameRolePrefix}${content}`);
    }
    
    console.log(formattedMessage);
    console.log(); // Add a blank line for readability
  }
}

/**
 * Specialized agent that moderates the meeting
 */
class ModeratorAgent extends Agent {
  /**
   * Create a new moderator agent
   * @param {Object} options - Moderator options
   * @param {Object} options.client - Anthropic API client
   * @param {Array} options.agenda - Meeting agenda items
   * @param {Object} options.availablePersonas - Available personas for the meeting
   * @param {string} options.lowEndModel - Model to use for urgency calculations
   * @param {string} options.highEndModel - Model to use for main responses
   * @param {string} options.meetingPurpose - Purpose of the meeting
   */
  constructor({
    client,
    agenda,
    availablePersonas,
    lowEndModel = 'claude-3-haiku-20240307',
    highEndModel = 'claude-3-opus-20240229',
    meetingPurpose = 'Weekly team meeting'
  }) {
    super({
      agentId: 'moderator',
      name: 'Meeting Moderator',
      persona: 'Professional meeting facilitator who ensures discussions stay on track and all voices are heard',
      role: 'Moderator',
      color: 'whiteBright',
      client,
      lowEndModel,
      highEndModel
    });
    
    this.agenda = agenda;
    this.currentAgendaItem = 0;
    this.availablePersonas = availablePersonas;
    this.selectedPersonas = {};
    this.meetingPurpose = meetingPurpose;
  }

  /**
   * Select which personas should participate in the meeting based on the agenda
   * @returns {Promise<Object>} Selected personas
   */
  async selectParticipants() {
    const systemPrompt = `
      You are a meeting moderator planning the participants for a meeting.
      
      The meeting agenda is:
      ${JSON.stringify(this.agenda, null, 2)}
      
      Available personas are:
      ${JSON.stringify(Object.fromEntries(
        Object.entries(this.availablePersonas).map(([k, v]) => [k, v.description])
      ), null, 2)}
      
      Select which personas should attend this meeting based on the agenda items.
      Return ONLY a JSON array of persona IDs that should attend, nothing else.
    `;
    
    try {
      const response = await this.client.messages.create({
        model: this.highEndModel,
        max_tokens: 500,
        system: systemPrompt,
        messages: [
          { role: 'user', content: 'Select the participants for this meeting.' }
        ]
      });
      
      // Extract JSON array from response
      const responseText = response.content[0].text;
      
      // Find JSON array in the text (handle cases where Claude adds explanation)
      const jsonMatch = responseText.match(/\[(.*)\]/s);
      let selectedIds;
      
      if (jsonMatch) {
        const jsonText = '[' + jsonMatch[1] + ']';
        selectedIds = JSON.parse(jsonText.replace(/\n/g, ''));
      } else {
        // Fallback if regex fails
        selectedIds = JSON.parse(responseText);
      }
      
      // Filter to only include available personas
      selectedIds = selectedIds.filter(pid => this.availablePersonas[pid]);
      
      // Ensure we have at least 2 participants plus moderator
      if (selectedIds.length < 2) {
        // Add a few random personas if not enough were selected
        const additionalNeeded = 2 - selectedIds.length;
        const availableIds = Object.keys(this.availablePersonas)
          .filter(id => !selectedIds.includes(id));
          
        if (availableIds.length > 0) {
          for (let i = 0; i < Math.min(additionalNeeded, availableIds.length); i++) {
            const randomIndex = Math.floor(Math.random() * availableIds.length);
            selectedIds.push(availableIds[randomIndex]);
            availableIds.splice(randomIndex, 1);
          }
        }
      }
      
      // Create selected personas dict
      const selected = {};
      for (const pid of selectedIds) {
        selected[pid] = this.availablePersonas[pid];
      }
      
      return selected;
      
    } catch (error) {
      console.error('Error selecting participants:', error.message);
      
      // Fallback: select a random subset of 2-4 personas
      const availableIds = Object.keys(this.availablePersonas);
      const numToSelect = Math.min(4, availableIds.length);
      const selectedIds = [];
      
      for (let i = 0; i < numToSelect; i++) {
        const randomIndex = Math.floor(Math.random() * availableIds.length);
        selectedIds.push(availableIds[randomIndex]);
        availableIds.splice(randomIndex, 1);
      }
      
      const selected = {};
      for (const pid of selectedIds) {
        selected[pid] = this.availablePersonas[pid];
      }
      
      return selected;
    }
  }

  /**
   * Generate the meeting introduction and first agenda item
   * @returns {Promise<string>} Introduction text
   */
  async startMeeting() {
    const systemPrompt = `
      You are the meeting moderator starting a meeting.
      
      Meeting purpose: "${this.meetingPurpose}"
      
      The full agenda is:
      ${JSON.stringify(this.agenda, null, 2)}
      
      Write a short introduction that:
      1. Welcomes everyone to the meeting
      2. Clearly states the purpose of the meeting: "${this.meetingPurpose}"
      3. Summarizes the overall agenda structure
      4. Introduces the first agenda item: "${this.agenda[0]}"
      
      Keep it concise, professional, and energetic.
    `;
    
    const response = await this.client.messages.create({
      model: this.highEndModel,
      max_tokens: 300,
      system: systemPrompt,
      messages: [
        { role: 'user', content: 'Please start the meeting.' }
      ]
    });
    
    this.currentAgendaItem = 0;
    return response.content[0].text;
  }

  /**
   * Move to the next agenda item and generate a transition message
   * @param {Array} conversation - Conversation history
   * @returns {Promise<string|null>} Transition text or null if meeting is over
   */
  async nextAgendaItem(conversation) {
    this.currentAgendaItem += 1;
    if (this.currentAgendaItem >= this.agenda.length) {
      return this.endMeeting(conversation);
    }
    
    // Get relevant messages for the current agenda item
    const currentItemMessages = [];
    let foundStart = false;
    
    for (let i = conversation.length - 1; i >= 0; i--) {
      const message = conversation[i];
      
      if (!foundStart && message.agentId === 'moderator' && 
          message.content.includes(this.agenda[this.currentAgendaItem - 1])) {
        foundStart = true;
      }
      
      if (foundStart) {
        currentItemMessages.unshift(message);
      }
    }
    
    const systemPrompt = `
      You are the meeting moderator transitioning to the next agenda item.
      
      The previous agenda item was: "${this.agenda[this.currentAgendaItem - 1]}"
      The next agenda item is: "${this.agenda[this.currentAgendaItem]}"
      
      Review the discussion of the previous agenda item and provide:
      1. A brief summary of the key points and decisions made
      2. A short introduction to the next agenda item
      
      Keep it concise and professional.
    `;
    
    const response = await this.client.messages.create({
      model: this.highEndModel,
      max_tokens: 350,
      system: systemPrompt,
      messages: [
        { 
          role: 'user', 
          content: 'Discussion transcript for the previous agenda item:\n' + 
           currentItemMessages.map(m => `${m.agentId || 'User'}: ${m.content}`).join('\n')
        }
      ]
    });
    
    return response.content[0].text;
  }

  /**
   * Generate a meeting conclusion message
   * @param {Array} conversation - Conversation history
   * @returns {Promise<string>} Conclusion text
   */
  async endMeeting(conversation) {
    const systemPrompt = `
      You are the meeting moderator concluding a meeting.
      
      The meeting agenda was:
      ${JSON.stringify(this.agenda, null, 2)}
      
      Write a concise closing statement that:
      1. Summarizes the key points and decisions from the meeting
      2. Outlines any action items or next steps
      3. Thanks everyone for their participation
      
      Keep it professional and under 200 words.
    `;
    
    // Get the last portion of the conversation to summarize
    const recentMessages = conversation.slice(-Math.min(20, conversation.length));
    
    const response = await this.client.messages.create({
      model: this.highEndModel,
      max_tokens: 400,
      system: systemPrompt,
      messages: [
        { 
          role: 'user', 
          content: 'Meeting transcript excerpt:\n' + 
           recentMessages.map(m => `${m.agentId || 'User'}: ${m.content}`).join('\n')
        }
      ]
    });
    
    return response.content[0].text;
  }

  /**
   * Decide which agent should speak next
   * @param {Object} agents - Available agents
   * @param {Array} conversation - Conversation history
   * @returns {Promise<string>} ID of the next speaker
   */
  async chooseNextSpeaker(agents, conversation) {
    const systemPrompt = `
      You are the meeting moderator deciding who should speak next.
      
      Current agenda item: "${this.agenda[this.currentAgendaItem]}"
      
      Review the recent conversation and decide which participant should speak next.
      Consider:
      - Who has relevant expertise for the current topic
      - Who hasn't spoken recently and might have valuable input
      - The natural flow of conversation
      
      Return ONLY the ID of the agent who should speak next, nothing else.
    `;
    
    // Get the last portion of the conversation
    const recentMessages = conversation.slice(-Math.min(10, conversation.length));
    
    try {
      const response = await this.client.messages.create({
        model: this.lowEndModel,
        max_tokens: 50,
        system: systemPrompt,
        messages: [
          { 
            role: 'user', 
            content: `
              Recent conversation:
              ${JSON.stringify(recentMessages.map(m => ({
                agent: m.agentId,
                content: m.content
              })), null, 2)}
              
              Available participants:
              ${JSON.stringify(Object.fromEntries(
                Object.entries(agents).map(([id, agent]) => [id, agent.name])
              ), null, 2)}
              
              Who should speak next? Respond with only their agent_id.
            `
          }
        ]
      });
      
      let nextSpeaker = response.content[0].text.trim();
      
      // Clean up response to just get the agent ID
      if (!agents[nextSpeaker]) {
        // Try to extract just the ID if the model added explanation
        const idMatch = nextSpeaker.match(/([a-z_]+)/);
        if (idMatch) {
          nextSpeaker = idMatch[1];
        }
      }
      
      if (agents[nextSpeaker]) {
        return nextSpeaker;
      } else {
        // Fallback: choose someone who hasn't spoken recently
        const agentIds = Object.keys(agents).filter(id => id !== 'moderator');
        return agentIds[Math.floor(Math.random() * agentIds.length)];
      }
      
    } catch (error) {
      console.error('Error choosing next speaker:', error.message);
      
      // Random fallback
      const agentIds = Object.keys(agents).filter(id => id !== 'moderator');
      return agentIds[Math.floor(Math.random() * agentIds.length)];
    }
  }

  /**
   * Determine if it's time to move to the next agenda item
   * @param {Array} conversation - Conversation history
   * @returns {Promise<boolean>} True if it's time to move on
   */
  async shouldMoveToNextAgendaItem(conversation) {
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
    const currentItemMessages = [];
    let foundStart = false;
    
    for (const message of conversation) {
      if (!foundStart && message.agentId === 'moderator' && 
           message.content.includes(this.agenda[this.currentAgendaItem])) {
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
      const response = await this.client.messages.create({
        model: this.lowEndModel,
        max_tokens: 10,
        system: systemPrompt,
        messages: [
          { 
            role: 'user', 
            content: 'Recent discussion:\n' + 
             currentItemMessages.slice(-10).map(m => 
               `${m.agentId || 'User'}: ${m.content}`
             ).join('\n')
          }
        ]
      });
      
      const decision = response.content[0].text.trim().toUpperCase();
      return decision.includes('YES');
      
    } catch (error) {
      console.error('Error deciding on agenda progression:', error.message);
      // Default to continuing the current item
      return false;
    }
  }
}

export { Agent, ModeratorAgent };