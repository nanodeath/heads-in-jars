/**
 * API client for Anthropic's Claude API
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { TokenUsage } from '../types.js';
import { debugLog } from '../utils/formatting.js';
import { withRetryLogic } from '../utils/retries.js';

/**
 * Response from a message creation API call
 */
export interface MessageResponse {
  content: Array<{ text: string }>;
  usage: TokenUsage;
}

export interface MessageParam {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Parameters for creating a message
 */
export interface MessageParams {
  model: string;
  max_tokens: number;
  system: string;
  messages: MessageParam[];
}

export class AnthropicClient {
  constructor(private client: Anthropic) {}

  /**
   * Creates a non-streaming message using the Claude API
   *
   * @param client The Anthropic client
   * @param params Message creation parameters
   * @param actionDescription Description for logging
   * @param fallbackMessage Optional fallback message on error
   * @returns The API response
   */
  async createMessage(
    params: MessageParams,
    actionDescription: string,
    fallbackMessage?: string,
  ): Promise<MessageResponse> {
    return withRetryLogic(
      // API call function
      async () => {
        const res = await this.client.messages.create(params);

        // Check response validity
        if (!res || !res.content || !res.content.length) {
          throw new Error('Empty response received from API');
        }

        return {
          ...res,
          content: res.content.filter((c) => c.type === 'text'),
        };
      },
      // Description
      actionDescription,
      // Options
      fallbackMessage
        ? {
            fallbackFn: async (error) => {
              debugLog(`Using fallback for ${actionDescription}: ${error.message}`);
              return {
                content: [{ text: fallbackMessage, type: 'text' }],
                usage: {
                  input_tokens: 0,
                  output_tokens: fallbackMessage.length / 4,
                } as TokenUsage,
              };
            },
          }
        : undefined,
    );
  }

  /**
   * Creates a streaming message with the Claude API
   *
   * @param params Message creation parameters
   * @param onChunk Callback for each text chunk
   * @returns The full response text
   */
  async createStreamingMessage(
    params: MessageParams,
    onChunk?: (chunk: string, fullResponse: string) => void,
  ): Promise<string> {
    let fullResponse = '';

    try {
      // Create streaming request
      const stream = await this.client.messages.create({ ...params, stream: true });

      // Process each chunk as it arrives
      for await (const messageStreamEvent of stream) {
        messageStreamEvent.type;
        if (
          messageStreamEvent.type === 'content_block_delta' &&
          messageStreamEvent.delta?.type === 'text_delta' &&
          messageStreamEvent.delta?.text
        ) {
          const chunk = messageStreamEvent.delta.text;

          fullResponse += chunk;
          onChunk ? onChunk(chunk, fullResponse) : void 0;
        }
      }

      return fullResponse;
    } catch (error: unknown) {
      console.error(`Error in streaming response: ${error instanceof Error ? error.message : error}`, error);
      throw error;
    }
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
