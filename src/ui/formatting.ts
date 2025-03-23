/**
 * UI formatting utilities
 */

import chalk from "chalk";

/**
 * Get a chalk color function from a color name
 *
 * @param colorName The name of the color
 * @returns The chalk color function
 */
export function getChalkColor(colorName: string): (text: string) => string {
	// Handle chalk color safely with a type assertion
	const chalkColor = (chalk as any)[colorName];

	// If the color doesn't exist, use default white
	return chalkColor || chalk.white;
}

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
	colorName: string,
): string {
	const nameRolePrefix = `${agentName} [${roleTitle}]: `;
	const chalkColor = getChalkColor(colorName);

	// Check if content already has the prefix
	if (content.startsWith(nameRolePrefix)) {
		return chalkColor(content);
	} else {
		return chalkColor(`${nameRolePrefix}${content}`);
	}
}
