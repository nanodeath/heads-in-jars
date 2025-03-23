/**
 * UI formatting utilities
 */

import type { ChalkInstance } from 'chalk';

/**
 * Format a message with agent name and role
 *
 * @param content Message content
 * @param agentName Agent name
 * @param roleTitle Agent role title
 * @param colorName Color name for chalk
 * @returns Formatted message
 */
export function formatAgentMessage(
  content: string,
  agentName: string,
  roleTitle: string,
  color: ChalkInstance,
): string {
  const nameRolePrefix = `${agentName} [${roleTitle}]: `;

  // Check if content already has the prefix
  if (content.startsWith(nameRolePrefix)) {
    return color(content);
  }
  return color(`${nameRolePrefix}${content}`);
}
