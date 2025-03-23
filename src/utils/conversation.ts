/**
 * Conversation-related utilities
 */

import { Message, MessageRole } from '../types.js';

/**
 * Create a message object for the conversation
 */
export function createMessage(
  role: MessageRole,
  content: string,
  agentId: string | null = null,
  agentName: string | null = null,
  agentRole: string | null = null
): Message {
  return {
    role,
    content,
    agentId,
    agentName,
    agentRole,
    timestamp: Date.now()
  };
}

/**
 * Clean a response by removing common self-reference patterns
 * 
 * @param text The text to clean
 * @param name The agent's name
 * @param role The agent's role
 * @returns The cleaned text
 */
export function removeNamePrefix(text: string, name: string, role: string): string {
  // Common patterns of the agent referring to themselves
  const selfReferencePatterns = [
    `${name}: `,
    `${name} [${role}]: `,
    `${name}[${role}]: `,
    `${name}[${role}]:`,
    `${name} [${role}]:`,
    `${name}, ${role}: `,
  ];
  
  // Find and remove any self-reference prefix
  for (const pattern of selfReferencePatterns) {
    if (text.startsWith(pattern)) {
      return text.substring(pattern.length);
    }
  }
  
  // Return original text if no patterns match
  return text;
}