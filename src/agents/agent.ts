/**
 * Base Agent class
 */

import type { ChalkInstance } from 'chalk';
import type { AnthropicClient, MessageParams } from '../api/index.js';
import { createResponsePrompt, createUrgencyPrompt } from '../api/prompts.js';
import type { AgentOptions, Message } from '../types.js';
import { completeStreamedMessage, printAgentMessage, printStreamingChunk } from '../ui/messaging.js';
import { removeNamePrefix } from '../utils/conversation.js';
import { calculateCost } from '../utils/costs.js';
import { debugLog } from '../utils/formatting.js';

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
    this.introduction = '';
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
      const messageParams: MessageParams = {
        model: this.lowEndModel,
        max_tokens: 10,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      };

      const response = await this.client.createMessage(
        messageParams,
        `calculating urgency for ${this.name}`,
        '3', // Default medium urgency
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
      const urgencyText = response.content[0].text.trim();
      let urgency = Number.parseFloat(urgencyText) || 3.0;

      // Clamp between 1-5
      urgency = Math.max(1.0, Math.min(5.0, urgency));

      const totalUrgency = urgency;

      // Log the urgency calculation
      debugLog(`${this.name} urgency calculation:`, {
        baseUrgency: urgency,
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
  async generateResponse(conversation: Message[], onStream?: (chunk: string) => void): Promise<string> {
    // Create the system prompt
    const systemPrompt = createResponsePrompt(this.name, this.persona, this.role);

    // Format conversation for the API
    const formattedMessages: MessageParams['messages'] = conversation.map((message) => {
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
      };
    });

    // Log the request in debug mode
    debugLog(`Response API request for ${this.name}`, {
      model: this.highEndModel,
      system: systemPrompt,
      messages: formattedMessages,
    });

    // Setup parameters for the API call
    const messageParams: MessageParams = {
      model: this.highEndModel,
      max_tokens: this.maxTokens,
      system: systemPrompt,
      messages: formattedMessages,
    };

    try {
      // Use streaming or standard API call based on whether a callback was provided
      if (onStream) {
        // Use streaming API for real-time output
        return await this.client.createStreamingMessage(messageParams, onStream);
      }
      // Use non-streaming API call
      const response = await this.client.createMessage(
        messageParams,
        `generating response for ${this.name}`,
        `I'd like to share my thoughts on this, but I'm having technical difficulty at the moment.`,
      );

      // Clean up the response to remove any self-references
      let responseText = response.content[0].text;
      const cleanedText = removeNamePrefix(responseText, this.name, this.role);

      // If we cleaned something, log it
      if (cleanedText !== responseText) {
        debugLog('Stripped self-reference prefix from response');
        responseText = cleanedText;
      }

      // Log the response in debug mode
      debugLog(`Response API response for ${this.name}`, {
        content: responseText,
        usage: response.usage,
      });

      // Calculate and log cost estimate
      const costEstimate = calculateCost(this.highEndModel, response.usage);
      debugLog(`💰 Cost estimate for ${this.name} response generation:`, {
        model: this.highEndModel,
        inputTokens: costEstimate.inputTokens,
        outputTokens: costEstimate.outputTokens,
        inputCost: `$${costEstimate.inputCost}`,
        outputCost: `$${costEstimate.outputCost}`,
        totalCost: `$${costEstimate.totalCost}`,
      });

      return responseText;
    } catch (error: unknown) {
      console.error(`Error generating response for ${this.name}:`, error);
      const message = error instanceof Error ? error.message : 'unknown cause';
      return `[Error generating response: ${message}]`;
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

    if (streaming) {
      // For streaming output
      printStreamingChunk(content, this.color, isFirstChunk, this.name, roleTitle);
    } else {
      // For non-streaming output
      printAgentMessage(content, this.name, roleTitle, this.color);
    }
  }

  /**
   * Completes a streamed message by adding a blank line
   */
  completeStreamedMessage(): void {
    completeStreamedMessage();
  }
}
