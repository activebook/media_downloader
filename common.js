// Common utility functions shared across the extension

const REQUEST_ACTION_DOWNLOAD_HLS = 'downloadHLS';
const REQUEST_ACTION_CANCEL_HLS_DOWNLOAD = 'cancelHLSDownload';
const REQUEST_ACTION_DOWNLOAD_VIDEO_FROM_PAGE = 'downloadVideoFromPage';
const REQUEST_ACTION_MEDIA_DETECTED = 'mediaDetected';
const REQUEST_ACTION_MEDIA_REFRESH = 'mediaRefresh';

/**
 * Get the currently active tab in a promise-based way
 * @returns {Promise<number>} Active tab ID
 */
async function getActiveTabId() {
  if (!chrome.runtime?.id) {
    throw new Error('Extension context unavailable');
  }
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id ?? null;
}

/*
 * Check if a tab ID is valid
 * @param {number} tabId - The tab ID to check
 * @returns {Promise<boolean>} True if the tab ID is valid, false otherwise
 */
async function isValidTab(tabId) {
  if (typeof tabId !== 'number' || tabId < 0) {
    return false;
  }

  if (!chrome.runtime?.id) {
    return false;
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    return tab && !tab.discarded;
  } catch {
    return false;
  }
}

/*
 * Send a message to a specific tab
 * @param {number} tabId - The ID of the tab to send the message to
 * @param {Object} message - The message to send
 * @returns {Promise<Object>} The response from the tab
 */
async function sendMessage(tabId, message) {
  if (!chrome.runtime?.id) {
    throw new Error('Extension context unavailable');
  }
  try {
    const response = await chrome.tabs.sendMessage(tabId, message);
    return response;
  } catch (error) {
    throw new Error(`Failed to send message to tab ${tabId}:`, error.message);
  }
}

/*
 * Send a message to all tabs
 * @param {Object} message - The message to send
 * @returns {Promise<Object>} The response from the tabs
 */
async function sendBroadcast(message) {
  if (!chrome.runtime?.id) {
    throw new Error('Extension context unavailable');
  }
  try {
    const response = await chrome.runtime.sendMessage(message);
    return response;
  } catch (error) {
    throw new Error(`Failed to send broadcast message:`, error.message);
  }
}

// Usage
// await sendMessage(tabId, { action: 'updateUI', data: {...} });
