/**
 * Create a message object for the conversation
 * @param {string} role - Message role ('user' or 'assistant')
 * @param {string} content - Message content
 * @param {string|null} agentId - Agent ID for assistant messages
 * @param {string|null} agentName - Agent name for assistant messages
 * @param {string|null} agentRole - Agent role for assistant messages
 * @returns {Object} Message object
 */
export function createMessage(role, content, agentId = null, agentName = null, agentRole = null) {
    return {
      role,
      content,
      agentId,
      agentName,
      agentRole,
      timestamp: Date.now()
    };
  }
  
  /**
   * Sleep for a specified duration
   * @param {number} ms - Duration in milliseconds
   * @returns {Promise<void>}
   */
  export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Format a duration as a readable string
   * @param {number} ms - Duration in milliseconds
   * @returns {string} Formatted duration
   */
  export function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
  
  /**
   * Truncate text to a maximum length
   * @param {string} text - Text to truncate
   * @param {number} maxLength - Maximum length
   * @returns {string} Truncated text
   */
  export function truncateText(text, maxLength = 100) {
    if (text.length <= maxLength) {
      return text;
    }
    
    return text.substring(0, maxLength - 3) + '...';
  }
  
  /**
   * Check if a string contains any items from an array
   * @param {string} text - Text to check
   * @param {Array} items - Items to check for
   * @returns {boolean} True if text contains any item
   */
  export function containsAny(text, items) {
    if (!text) return false;
    
    const lowerText = text.toLowerCase();
    return items.some(item => lowerText.includes(item.toLowerCase()));
  }
  
  /**
   * Generate a unique ID
   * @returns {string} Unique ID
   */
  export function generateId() {
    return Math.random().toString(36).substring(2, 15);
  }
  
  /**
   * Debug logging utility - only logs when debug mode is enabled
   * @param {string} message - The message to log
   * @param {Object|string} [data] - Optional data to log (will be JSON stringified if object)
   */
  export function debugLog(message, data) {
    // This will be set to true in index.js when --debug flag is present
    if (!global.isDebugMode) return;
    
    // Use gray color for debug messages to be more subtle
    const timestamp = new Date().toISOString().slice(11, 19); // HH:MM:SS
    
    if (data === undefined) {
      console.log(`\x1b[90m[DEBUG ${timestamp}] ${message}\x1b[0m`);
    } else {
      const dataString = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
      console.log(`\x1b[90m[DEBUG ${timestamp}] ${message}\n${dataString}\x1b[0m`);
    }
  }
  
  /**
   * Calculate estimated cost for an API call based on token usage
   * @param {string} model - The model name
   * @param {Object} usage - The usage object from the API response
   * @returns {Object} Cost estimate information
   */
  export function calculateCost(model, usage) {
    if (!usage || !usage.input_tokens || !usage.output_tokens) {
      return { 
        inputCost: 'unknown', 
        outputCost: 'unknown', 
        totalCost: 'unknown',
        disclaimer: 'No token usage data available'
      };
    }
    
    const inputTokens = usage.input_tokens;
    const outputTokens = usage.output_tokens;
    
    // Pricing per 1M tokens (as of March 2024)
    // These are approximate and may change
    const pricing = {
      // Claude 3 models
      'claude-3-opus': { input: 15.00, output: 75.00 },
      'claude-3-sonnet': { input: 3.00, output: 15.00 },
      'claude-3-haiku': { input: 0.25, output: 1.25 },
      // Claude 3.5 models
      'claude-3-5-sonnet': { input: 3.00, output: 15.00 },
      'claude-3-5-haiku': { input: 0.25, output: 1.25 },
      // Claude 3.7 models
      'claude-3-7-sonnet': { input: 5.00, output: 25.00 }
    };
    
    // Find the matching price model (handle "latest" variants)
    let price;
    for (const [priceModel, priceData] of Object.entries(pricing)) {
      if (model.includes(priceModel)) {
        price = priceData;
        break;
      }
    }
    
    // If no matching price found, use a default
    if (!price) {
      price = { input: 3.00, output: 15.00 }; // Default to Sonnet pricing
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
      disclaimer: 'Cost is approximate and based on public pricing'
    };
  }
  
/**
 * Execute an API call with retry logic for rate limiting and transient errors
 * @param {Function} apiCall - Async function that makes the API call
 * @param {string} actionDescription - Description of what the API call is doing
 * @param {Object} options - Additional options
 * @param {number} options.retryDelay - Delay in ms before retry (default: 10000ms)
 * @param {Function} options.onRetry - Callback before retry
 * @param {Function} options.fallbackFn - Function to call if all retries fail
 * @returns {Promise<any>} The API response
 */
export async function withRetryLogic(apiCall, actionDescription, options = {}) {
  const retryDelay = options.retryDelay || 10000; // Default to 10 seconds
  const maxRetries = 1; // Try at most once more
  
  try {
    // First attempt
    return await apiCall();
  } catch (error) {
    // Check if it's a rate limit error (HTTP 429), a gateway error (HTTP 5xx), or empty response
    const isRateLimitError = error.status === 429;
    const isGatewayError = error.status >= 500 && error.status < 600;
    const isEmptyResponse = error.message && error.message.includes('Empty response');
    
    if ((isRateLimitError || isGatewayError || isEmptyResponse) && maxRetries > 0) {
      // Show retry message
      console.log(`\n😴 ${error.message} while ${actionDescription}. Waiting ${retryDelay/1000} seconds before retry...`);
      
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
      } catch (retryError) {
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