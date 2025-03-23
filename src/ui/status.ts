/**
 * Status update utilities
 */

/**
 * Simple callback type for status updates
 */
export type StatusCallback = (message: string) => void;

/**
 * Create a status update function that properly handles status callbacks
 * 
 * @param callback Status callback function or null
 * @returns Function to call for status updates
 */
export function createStatusUpdater(
  callback: StatusCallback | null
): StatusCallback {
  return (message: string) => {
    if (callback && typeof callback === 'function') {
      callback(message);
    }
  };
}