/**
 * Utilities for streaming API responses
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { TokenUsage } from '../types.js';
import { removeNamePrefix } from '../utils/conversation.js';
import { debugLog } from '../utils/formatting.js';
import type { MessageParams } from './client.js';

/**
 * Creates a streaming message with the Claude API
 *
 * @param client The Anthropic client
 * @param params Message creation parameters
 * @param onChunk Callback for each text chunk
 * @param agentName Agent name for text cleaning
 * @param agentRole Agent role for text cleaning
 * @returns The full response text
 */
export async function createStreamingMessage(
  client: Anthropic,
  params: MessageParams & { stream: true },
  onChunk: (chunk: string) => void,
  agentName: string,
  agentRole: string,
): Promise<string> {
  let fullResponse = '';

  try {
    // Create streaming request
    const stream = await client.messages.create(params);

    // Process each chunk as it arrives
    for await (const messageStreamEvent of stream) {
      if (
        messageStreamEvent.type === 'content_block_delta' &&
        messageStreamEvent.delta?.type === 'text_delta' &&
        messageStreamEvent.delta?.text
      ) {
        let chunk = messageStreamEvent.delta.text;

        // Check if this is the first chunk and contains name prefixes to strip
        if (fullResponse === '') {
          // Remove any self-reference prefix in the first chunk
          const cleanedChunk = removeNamePrefix(chunk, agentName, agentRole);

          // If we removed something, log it
          if (cleanedChunk !== chunk) {
            debugLog('Stripped self-reference prefix from streaming response');
            chunk = cleanedChunk;
          }
        }

        fullResponse += chunk;
        onChunk(chunk);
      }
    }

    return fullResponse;
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(`Error in streaming response: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Estimates token usage for a streaming response
 *
 * @param messages The input messages
 * @param fullResponse The full response text
 * @returns Estimated token usage
 */
export function estimateTokenUsage(messages: Array<{ content: string }>, fullResponse: string): TokenUsage {
  return {
    input_tokens: messages.reduce((acc, msg) => acc + msg.content.length / 4, 0),
    output_tokens: fullResponse.length / 4,
  };
}
