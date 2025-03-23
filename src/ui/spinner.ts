/**
 * Spinner and progress indicators
 */

import ora, { type Ora } from "ora";

/**
 * Create a spinner with a given message
 *
 * @param message The spinner message
 * @param color Optional color for the spinner
 * @returns Ora spinner instance
 */
export function createSpinner(message: string, color?: string): Ora {
	return ora({
		text: message,
		color: (color || "cyan") as any,
	});
}

/**
 * Create a participant thinking status spinner
 *
 * @param statuses Status object with agent IDs as keys and status strings as values
 * @param agents Map of agent objects with names and other properties
 * @returns Ora spinner instance
 */
export function createThinkingSpinner(
	statuses: Record<string, string>,
	agents: Record<string, { name: string }>,
): Ora {
	const statusLine = formatStatusLine(statuses, agents);

	return ora({
		text: statusLine,
		color: "cyan",
	});
}

/**
 * Format a status line for the thinking spinner
 *
 * @param statuses Status object with agent IDs as keys and status strings as values
 * @param agents Map of agent objects with names
 * @returns Formatted status line
 */
export function formatStatusLine(
	statuses: Record<string, string>,
	agents: Record<string, { name: string }>,
): string {
	const statusItems = Object.entries(statuses).map(([agentId, status]) => {
		const agent = agents[agentId];
		let emoji;

		switch (status) {
			case "zipped":
				emoji = "🤐"; // Zipper-mouth face for last speaker
				break;
			case "thinking":
				emoji = "🔄"; // Thinking
				break;
			case "next":
				emoji = "✋"; // Next speaker gets raised hand emoji
				break;
			default:
				emoji = "✅"; // Finished thinking
		}

		return `${agent.name} ${emoji}`;
	});

	return `Who's next: ${statusItems.join(" | ")}`;
}

/**
 * Update the spinner with the next speaker
 *
 * @param spinner The spinner to update
 * @param statuses The current status object
 * @param agents Map of agent objects with names
 * @param nextSpeakerId The ID of the next speaker
 */
export function updateSpinnerWithNextSpeaker(
	spinner: Ora,
	statuses: Record<string, string>,
	agents: Record<string, { name: string }>,
	nextSpeakerId: string,
): void {
	// Update statuses to mark the next speaker
	const updatedStatuses = { ...statuses };

	// Mark the next speaker with hand raised
	Object.keys(updatedStatuses).forEach((id) => {
		if (id === nextSpeakerId) {
			updatedStatuses[id] = "next";
		}
	});

	// Update spinner text
	spinner.text = formatStatusLine(updatedStatuses, agents);
}
