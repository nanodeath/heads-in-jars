import type { ApiError, CostEstimate, Message, MessageRole, ModelPricing, RetryOptions, TokenUsage } from './types.js';

/**
 * Create a message object for the conversation
 */
export function createMessage(
  role: MessageRole,
  content: string,
  agentId: string | null = null,
  agentName: string | null = null,
  agentRole: string | null = null,
): Message {
  return {
    role,
    content,
    agentId,
    agentName,
    agentRole,
    timestamp: Date.now(),
  };
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Format a duration as a readable string
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Truncate text to a maximum length
 */
export function truncateText(text: string, maxLength = 100): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.substring(0, maxLength - 3)}...`;
}

/**
 * Check if a string contains any items from an array
 */
export function containsAny(text: string | null | undefined, items: string[]): boolean {
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
 * Calculate estimated cost for an API call based on token usage
 */
export function calculateCost(model: string, usage?: TokenUsage): CostEstimate {
  if (!usage || !usage.input_tokens || !usage.output_tokens) {
    return {
      inputCost: 'unknown',
      outputCost: 'unknown',
      totalCost: 'unknown',
      disclaimer: 'No token usage data available',
    };
  }

  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;

  // Pricing per 1M tokens (as of March 2024)
  // These are approximate and may change
  const pricing: ModelPricing = {
    // Claude 3 models
    'claude-3-opus': { input: 15.0, output: 75.0 },
    'claude-3-sonnet': { input: 3.0, output: 15.0 },
    'claude-3-haiku': { input: 0.25, output: 1.25 },
    // Claude 3.5 models
    'claude-3-5-sonnet': { input: 3.0, output: 15.0 },
    'claude-3-5-haiku': { input: 0.25, output: 1.25 },
    // Claude 3.7 models
    'claude-3-7-sonnet': { input: 5.0, output: 25.0 },
  };

  // Find the matching price model (handle "latest" variants)
  let price = { input: 3.0, output: 15.0 }; // Default to Sonnet pricing

  for (const [priceModel, priceData] of Object.entries(pricing)) {
    if (model.includes(priceModel)) {
      price = priceData;
      break;
    }
  }

  // Calculate costs in USD
  const inputCost = (inputTokens / 1000000) * price.input;
  const outputCost = (outputTokens / 1000000) * price.output;
  const totalCost = inputCost + outputCost;

  return {
    model,
    inputTokens,
    outputTokens,
    inputCost: inputCost.toFixed(6),
    outputCost: outputCost.toFixed(6),
    totalCost: totalCost.toFixed(6),
    disclaimer: 'Cost is approximate and based on public pricing',
  };
}

/**
 * Execute an API call with retry logic for rate limiting and transient errors
 */
export async function withRetryLogic<T>(
  apiCall: () => Promise<T>,
  actionDescription: string,
  options: RetryOptions<T> = {},
): Promise<T> {
  const retryDelay = options.retryDelay || 10000; // Default to 10 seconds
  const maxRetries = 1; // Try at most once more

  try {
    // First attempt
    return await apiCall();
  } catch (err) {
    const error = err as ApiError;

    // Check if it's a rate limit error (HTTP 429), a gateway error (HTTP 5xx), or empty response
    const isRateLimitError = error.status === 429;
    const isGatewayError = error.status && error.status >= 500 && error.status < 600;
    const isEmptyResponse = error.message?.includes('Empty response');

    if ((isRateLimitError || isGatewayError || isEmptyResponse) && maxRetries > 0) {
      // Show retry message
      console.log(
        `\n😴 ${error.message} while ${actionDescription}. Waiting ${retryDelay / 1000} seconds before retry...`,
      );

      // Call onRetry callback if provided
      if (options.onRetry) {
        options.onRetry(error);
      }

      // Wait for specified delay
      await sleep(retryDelay);

      try {
        // Retry the API call
        console.log(`🔄 Retrying ${actionDescription}...`);
        return await apiCall();
      } catch (retryErr) {
        const retryError = retryErr as Error;
        // If the retry also fails, log and use fallback
        console.error(`❌ Retry failed: ${retryError.message}`);

        if (options.fallbackFn) {
          console.log(`⚠️ Using fallback for ${actionDescription}`);
          return await options.fallbackFn(retryError);
        }

        // Re-throw if no fallback
        throw retryError;
      }
    } else {
      // For other errors or if we've used all retries, check if fallback exists
      if (options.fallbackFn) {
        console.log(`⚠️ Error occurred, using fallback for ${actionDescription}`);
        return await options.fallbackFn(error);
      }

      // Re-throw if no fallback
      throw error;
    }
  }
}
