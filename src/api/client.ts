/**
 * API client for Anthropic's Claude API
 */

import { withRetryLogic } from '../utils/retries.js';
import { TokenUsage } from '../types.js';
import { debugLog } from '../utils/formatting.js';

/**
 * Response from a message creation API call
 */
export interface MessageResponse {
  content: Array<{text: string}>;
  usage: TokenUsage;
}

/**
 * Parameters for creating a message
 */
export interface MessageParams {
  model: string;
  max_tokens: number;
  system: string;
  messages: Array<{role: string, content: string}>;
  stream?: boolean;
}

/**
 * Creates a message using the Claude API
 * 
 * @param client The Anthropic client
 * @param params Message creation parameters
 * @param actionDescription Description for logging
 * @param fallbackMessage Optional fallback message on error
 * @returns The API response
 */
export async function createMessage(
  client: any,
  params: MessageParams,
  actionDescription: string,
  fallbackMessage?: string
): Promise<MessageResponse> {
  return withRetryLogic(
    // API call function
    async () => {
      const res = await client.messages.create(params);
      
      // Check response validity
      if (!res || !res.content || !res.content.length) {
        throw new Error('Empty response received from API');
      }
      
      if (!res.content[0] || typeof res.content[0].text !== 'string') {
        throw new Error('Invalid response format from API');
      }
      
      return res;
    },
    // Description
    actionDescription,
    // Options
    fallbackMessage ? {
      fallbackFn: async (error) => {
        debugLog(`Using fallback for ${actionDescription}: ${error.message}`);
        return { 
          content: [{ text: fallbackMessage }],
          usage: { input_tokens: 0, output_tokens: fallbackMessage.length / 4 } as TokenUsage
        };
      }
    } : undefined
  );
}