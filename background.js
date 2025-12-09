// Background script to monitor network requests for media files
importScripts('license.js');

// Store media URLs with metadata
let mediaStore = new Map();
// Track if a merged download is currently active to prevent self-detection of segments
let isDownloadingActive = false;

// Track the current active tab ID
let activeTabId = null;

// Initialize active tab ID on startup
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  activeTabId = tabs[0]?.id || null;
});

// Initialize license on installation
chrome.runtime.onInstalled.addListener(() => {
  initLicense();
});

// Listen for tab activation changes
chrome.tabs.onActivated.addListener((activeInfo) => {
  activeTabId = activeInfo.tabId;
});

// Listen for tab updates to detect bilibili video pages
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId === activeTabId && changeInfo.status === 'complete' && tab.url) {
    handleBilibiliVideo(tab.url, tabId);
  }
});

// Listen for web requests
chrome.webRequest.onCompleted.addListener(
  (details) => {
    // Only process requests from the active tab
    if (details.tabId !== activeTabId) {
      return;
    }

    // console.log('Web req÷uest details:', details.url, details.responseHeaders);

    // If a known HLS download is active, ignore TS/segment files to prevent self-detection flood
    // if (isDownloadingActive) {
    // Regardless of download state, ignore TS/segment files to prevent self-detection flood
    if (details.url.endsWith('.ts') || details.url.includes('.ts?')) {
      return;
    }
    const type = details.responseHeaders?.find(header => header.name.toLowerCase() === 'content-type')?.value;
    if (type === 'video/mp2t' || type === 'application/octet-stream') {
      // Strict check: if it looks like a segment, ignore it.
      return;
    }
    // }

    const contentType = details.responseHeaders?.find(header =>
      header.name.toLowerCase() === 'content-type'
    )?.value;

    const contentDisposition = details.responseHeaders?.find(header =>
      header.name.toLowerCase() === 'content-disposition'
    )?.value;

    // console.log('Content-Type:', contentType);
    // console.log('Content-Disposition:', contentDisposition);

    let isMedia = false;
    let mediaType = contentType;

    if (contentType && (contentType.startsWith('video/') || contentType.startsWith('audio/') || contentType === 'application/octet-stream' || contentType === 'application/vnd.apple.mpegurl' || contentType === 'application/x-mpegurl')) {
      isMedia = true;
    } else if (contentDisposition && contentDisposition.includes('inline')) {
      // Check filename in content-disposition for media extensions
      const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
      if (filenameMatch) {
        const filename = filenameMatch[1].replace(/['"]/g, '');
        const extension = filename.split('.').pop().toLowerCase();
        const mediaExtensions = ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'm3u8'];
        if (mediaExtensions.includes(extension)) {
          isMedia = true;
          mediaType = `unknown/${extension}`;
          // console.log('Detected media via content-disposition filename extension:', filename, extension);
        }
      }
    }

    // Explicit check for m3u8 in URL if not yet detected
    if (!isMedia && (details.url.includes('.m3u8?') || details.url.endsWith('.m3u8'))) {
      isMedia = true;
      mediaType = 'application/vnd.apple.mpegurl';
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

      // console.log('Detected media:', mediaInfo);

      // Use URL as key to avoid duplicates
      if (!mediaStore.has(details.url)) {
        mediaStore.set(details.url, mediaInfo);

        // Store in chrome.storage for persistence
        chrome.storage.local.set({ mediaStore: Array.from(mediaStore.entries()) });
      } else {
        // console.log('Duplicate URL detected, skipping overwrite:', details.url);
      }
    }
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

// Listen for storage changes to track download state
chrome.storage.onChanged.addListener((changes, namespace) => {
  // if (changes.hlsDownloadState) {
  //   const state = changes.hlsDownloadState.newValue;
  //   isDownloadingActive = state && state.isDownloading;
  //   if (isDownloadingActive) {
  //     console.log('Download mode active - ignoring TS segment detection');
  //   } else {
  //     console.log('Download mode inactive - resuming normal detection');
  //   }
  // }
});

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

  if (request.action === 'mediaDetected') {
    const mediaInfo = request.mediaInfo;
    // Enrich with tabId from sender if not present (though content script can't see its own tabId easily)
    if (sender.tab) {
      mediaInfo.tabId = sender.tab.id;
    }

    // Add to store if new
    if (!mediaStore.has(mediaInfo.url)) {
      console.log('DOM detected media:', mediaInfo);
      mediaStore.set(mediaInfo.url, mediaInfo);
      chrome.storage.local.set({ mediaStore: Array.from(mediaStore.entries()) });
    }
    sendResponse({ received: true });
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

// Handle bilibili video page detection and API calls
async function handleBilibiliVideo(url, tabId) {
  // Check if URL is from bilibili.com and matches video pattern
  const urlObj = new URL(url);
  if (!urlObj.hostname.includes('bilibili.com') || !url.includes('/video/')) {
    return;
  }

  // Extract BV code using regex
  const bvMatch = url.match(/\/video\/(BV[0-9A-Za-z]+)/);
  if (!bvMatch) {
    return;
  }

  const bvCode = bvMatch[1];
  const apiBvCode = bvCode.substring(2); // Remove 'BV' prefix

  try {
    // Call the API to get MP4 URL
    const apiUrl = `https://api.injahow.cn/bparse/?bv=${apiBvCode}&otype=url`;
    const response = await fetch(apiUrl);

    if (!response.ok) {
      console.error('Bilibili API request failed:', response.status);
      return;
    }

    const mp4Url = await response.text();

    // Validate that we got a valid URL
    if (!mp4Url || !mp4Url.startsWith('http')) {
      console.error('Invalid MP4 URL received from API:', mp4Url);
      return;
    }

    // Create media info for the MP4 URL
    const mediaInfo = {
      url: mp4Url,
      type: 'video/mp4 [bilibili video]',
      size: 'Unknown', // API doesn't provide size
      timestamp: Date.now(),
      tabId: tabId,
      source: 'bilibili original' // Mark as coming from bilibili original video
    };

    // Add to media store (avoid duplicates)
    if (!mediaStore.has(mp4Url)) {
      mediaStore.set(mp4Url, mediaInfo);

      // Store in chrome.storage for persistence
      chrome.storage.local.set({ mediaStore: Array.from(mediaStore.entries()) });

      console.log('Added bilibili video to media store:', mp4Url);
    }
  } catch (error) {
    console.error('Error fetching bilibili video URL:', error);
  }
}

// --- HLS Download Logic Removed (Moved to Content Script) ---
// Service Workers cannot create ObjectURLs from Blobs efficiently in standard API.
