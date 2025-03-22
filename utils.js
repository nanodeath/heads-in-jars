/**
 * Create a message object for the conversation
 * @param {string} role - Message role ('user' or 'assistant')
 * @param {string} content - Message content
 * @param {string|null} agentId - Agent ID for assistant messages
 * @returns {Object} Message object
 */
export function createMessage(role, content, agentId = null) {
    return {
      role,
      content,
      agentId,
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