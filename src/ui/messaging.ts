/**
 * UI messaging utilities
 */

import chalk, { type ChalkInstance } from 'chalk';

/**
 * Print a complete message from an agent
 *
 * @param content Message content
 * @param agentName Agent name
 * @param roleTitle Agent role title
 * @param colorName Color name for chalk
 */
export function printAgentMessage(
  content: string,
  agentName: string,
  roleTitle: string,
  colorName: ChalkInstance,
): void {
  const nameRolePrefix = `${agentName} [${roleTitle}]: `;

  // Format the message properly - avoid duplication if the prefix already exists
  let formattedMessage: string;

  if (content.startsWith(nameRolePrefix)) {
    // Content already has the prefix, just use it directly
    formattedMessage = colorName(content);
  } else {
    // Add the prefix
    formattedMessage = colorName(`${nameRolePrefix}${content}`);
  }

  console.log(formattedMessage);
  console.log(); // Add a blank line for readability
}

/**
 * Print a streaming chunk from an agent
 *
 * @param chunk The text chunk to print
 * @param colorName Color name for chalk
 * @param isFirstChunk Whether this is the first chunk
 * @param agentName Agent name (only used for first chunk)
 * @param roleTitle Agent role title (only used for first chunk)
 */
export function printStreamingChunk(
  chunk: string,
  colorName: ChalkInstance,
  isFirstChunk: boolean,
  agentName?: string,
  roleTitle?: string,
): void {
  if (isFirstChunk && agentName && roleTitle) {
    // For the first chunk, print the prefix
    process.stdout.write(colorName(`${agentName} [${roleTitle}]: ${chunk}`));
  } else {
    // For subsequent chunks, just print the content in the same color
    process.stdout.write(colorName(chunk));
  }
}

/**
 * Complete a streamed message by adding blank lines
 */
export function completeStreamedMessage(): void {
  console.log('\n'); // Add two blank lines for readability after a streamed message
}

/**
 * Display section header with decorative borders
 *
 * @param title The header title
 */
export function displaySectionHeader(title: string): void {
  console.log(chalk.green('\n╭───────────────────────────────────────────────────╮'));
  console.log(chalk.green(`│${title.padStart((title.length + 47) / 2).padEnd(47)}│`));
  console.log(chalk.green('╰───────────────────────────────────────────────────╯\n'));
}
