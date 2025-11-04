// Background script to monitor network requests for media files

// Store media URLs with metadata
let mediaStore = new Map();

// Listen for web requests
chrome.webRequest.onCompleted.addListener(
  (details) => {
    const contentType = details.responseHeaders?.find(header =>
      header.name.toLowerCase() === 'content-type'
    )?.value;

    if (contentType && (contentType.startsWith('video/') || contentType.startsWith('audio/'))) {
      const mediaInfo = {
        url: details.url,
        type: contentType,
        size: details.responseHeaders?.find(header =>
          header.name.toLowerCase() === 'content-length'
        )?.value || 'Unknown',
        timestamp: Date.now(),
        tabId: details.tabId
      };

      // Use URL as key to avoid duplicates
      mediaStore.set(details.url, mediaInfo);

      // Store in chrome.storage for persistence
      chrome.storage.local.set({ mediaStore: Array.from(mediaStore.entries()) });
    }
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'refresh') {
    // Clear current media store for the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTabId = tabs[0]?.id;
      if (activeTabId) {
        // Remove media from closed tabs or old entries (older than 5 minutes)
        const now = Date.now();
        for (const [url, info] of mediaStore.entries()) {
          if (info.tabId !== activeTabId || (now - info.timestamp) > 300000) {
            mediaStore.delete(url);
          }
        }
        chrome.storage.local.set({ mediaStore: Array.from(mediaStore.entries()) });
      }
      sendResponse({ status: 'refreshed' });
    });
    return true; // Keep message channel open for async response
  }
});

// Clean up old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [url, info] of mediaStore.entries()) {
    if ((now - info.timestamp) > 600000) { // 10 minutes
      mediaStore.delete(url);
    }
  }
  chrome.storage.local.set({ mediaStore: Array.from(mediaStore.entries()) });
}, 60000); // Check every minute