/**
 * Conversation management utilities
 */

import type { Agent } from '../agents/agent.js';
import type { Message, MessageRole } from '../types.js';
import { createMessage as createMessageObj } from '../utils/conversation.js';

/**
 * Conversation manager class
 */
export class ConversationManager {
  conversation: Message[];
  agents: Record<string, Agent>;

  constructor(agents: Record<string, Agent>) {
    this.conversation = [];
    this.agents = agents;
  }

  /**
   * Add a message to the conversation history and update message counts
   */
  addMessage(role: MessageRole, content: string, agentId: string | null = null): void {
    let agentName: string | null = null;
    let agentRole: string | null = null;

    // If this is an agent message, include name and role
    if (role === 'assistant' && agentId && this.agents[agentId]) {
      const agent = this.agents[agentId];
      agentName = agent.name;
      agentRole = agent.role;
    }

    const message = createMessageObj(role, content, agentId, agentName, agentRole);
    this.conversation.push(message);
  }

  /**
   * Get the most recent messages from the conversation
   */
  getRecentMessages(count = 10): Message[] {
    return this.conversation.slice(-Math.min(count, this.conversation.length));
  }

  /**
   * Check if the last message was from a user
   */
  isLastMessageFromUser(): boolean {
    if (this.conversation.length === 0) {
      return false;
    }

    return this.conversation[this.conversation.length - 1].role === 'user';
  }

  /**
   * Get all messages for the current conversation
   */
  getAllMessages(): Message[] {
    return [...this.conversation];
  }
}
