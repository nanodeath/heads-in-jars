/**
 * Retry logic for API calls
 */

import type { ApiError, RetryOptions } from '../types.js';
import { sleep } from './time.js';

/**
 * Execute an API call with retry logic for rate limiting and transient errors
 */
export async function withRetryLogic<T>(
  apiCall: () => Promise<T>,
  actionDescription: string,
  options: RetryOptions = {},
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
