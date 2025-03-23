/**
 * Text formatting utility functions
 */

/**
 * Truncate text to a maximum length
 */
export function truncateText(text: string, maxLength = 100): string {
	if (text.length <= maxLength) {
		return text;
	}

	return text.substring(0, maxLength - 3) + "...";
}

/**
 * Check if a string contains any items from an array
 */
export function containsAny(
	text: string | null | undefined,
	items: string[],
): boolean {
	if (!text) return false;

	const lowerText = text.toLowerCase();
	return items.some((item) => lowerText.includes(item.toLowerCase()));
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
	return Math.random().toString(36).substring(2, 15);
}

/**
 * Debug logging utility - only logs when debug mode is enabled
 */
export function debugLog(message: string, data?: any): void {
	// This will be set to true in index.ts when --debug flag is present
	if (!global.isDebugMode) return;

	// Use gray color for debug messages to be more subtle
	const timestamp = new Date().toISOString().slice(11, 19); // HH:MM:SS

	if (data === undefined) {
		console.log(`\x1b[90m[DEBUG ${timestamp}] ${message}\x1b[0m`);
	} else {
		const dataString =
			typeof data === "object" ? JSON.stringify(data, null, 2) : data;
		console.log(
			`\x1b[90m[DEBUG ${timestamp}] ${message}\n${dataString}\x1b[0m`,
		);
	}
}
