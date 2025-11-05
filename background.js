// Background script to monitor network requests for media files

// Store media URLs with metadata
let mediaStore = new Map();

// Track the current active tab ID
let activeTabId = null;

// Initialize active tab ID on startup
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  activeTabId = tabs[0]?.id || null;
});

// Listen for tab activation changes
chrome.tabs.onActivated.addListener((activeInfo) => {
  activeTabId = activeInfo.tabId;
});

// Listen for web requests
chrome.webRequest.onCompleted.addListener(
  (details) => {
    // Only process requests from the active tab
    if (details.tabId !== activeTabId) {
      return;
    }

    console.log('Web request details:', details.url, details.responseHeaders);

    const contentType = details.responseHeaders?.find(header =>
      header.name.toLowerCase() === 'content-type'
    )?.value;

    const contentDisposition = details.responseHeaders?.find(header =>
      header.name.toLowerCase() === 'content-disposition'
    )?.value;

    console.log('Content-Type:', contentType);
    console.log('Content-Disposition:', contentDisposition);

    let isMedia = false;
    let mediaType = contentType;

    if (contentType && (contentType.startsWith('video/') || contentType.startsWith('audio/') || contentType === 'application/octet-stream')) {
      isMedia = true;
    } else if (contentDisposition && contentDisposition.includes('inline')) {
      // Check filename in content-disposition for media extensions
      const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
      if (filenameMatch) {
        const filename = filenameMatch[1].replace(/['"]/g, '');
        const extension = filename.split('.').pop().toLowerCase();
        const mediaExtensions = ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a'];
        if (mediaExtensions.includes(extension)) {
          isMedia = true;
          mediaType = `unknown/${extension}`;
          console.log('Detected media via content-disposition filename extension:', filename, extension);
        }
      }
    }

    if (isMedia) {
      const mediaInfo = {
        url: details.url,
        type: mediaType,
        size: details.responseHeaders?.find(header =>
          header.name.toLowerCase() === 'content-length'
        )?.value || 'Unknown',
        timestamp: Date.now(),
        tabId: details.tabId
      };

      console.log('Detected media:', mediaInfo);

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