// Background script to monitor network requests for media files
importScripts('license.js');
importScripts('logger.js');
importScripts('common.js');
importScripts('media_info.js');
importScripts('media_store.js');
importScripts('media_detector.js');

// Initialize logger
const logger = new ExtensionLogger('Background');

// Store media URLs with metadata
let mediaStore = new MediaStore();

// Track the current active tab ID
let activeTabId = null;

// Initialize license on installation
chrome.runtime.onInstalled.addListener(() => {
  initLicense();
});

// Listen for tab activation changes
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  activeTabId = await getActiveTabId();
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
    /**
     * Detects m3u8 in all iframes:
     * Will catch m3u8 requests from iframes in any tab, not just the active one
     * 
     * More comprehensive monitoring:
     * Will detect media from background tabs and iframes that aren't currently visible
     * 
     */
    // if (details.tabId !== activeTabId) {
    //   return;
    // }

    // Use MediaDetector to analyze the request
    const detection = MediaDetector.detect(details);

    if (detection) {
      // Create MediaInfo with detection results
      const mediaInfo = MediaInfo.create({
        url: detection.url,
        type: detection.type,
        size: detection.size,
        tabId: detection.tabId,
        timestamp: detection.timestamp,
        source: `web-request (${detection.detectionMethod})`
      });

      // logger.info('Detected media:', mediaInfo);

      // Add to MediaStore (handles duplicates and persistence)
      mediaStore.addMedia(mediaInfo);
    }
  },
  // The webRequest listener captures ALL network requests from the tab, including those made by iframes. 
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === REQUEST_ACTION_MEDIA_REFRESH) {
    // Clear old entries for the active tab
    if (activeTabId) {
      mediaStore.clearForTab(activeTabId, 5 * 60 * 1000); // 5 minutes
    }
    sendResponse({ status: 'refreshed' });
    return true; // Keep message channel open for async response
  }

  if (request.action === REQUEST_ACTION_MEDIA_GETSIZE) {
    // Fetch the size of the remote file
    fetch(request.url, { method: 'HEAD' })
      .then(response => {
        const contentLength = response.headers.get('content-length');
        sendResponse({ size: contentLength ? parseInt(contentLength) : null });
      })
      .catch(error => {
        sendResponse({ size: null, error: error.message });
      });
    return true; // Keep the message channel open for async response
  }

  if (request.action === REQUEST_ACTION_MEDIA_DETECTED) {
    let mediaInfo = request.mediaInfo;
    // Enrich with tabId from sender if not present
    if (sender.tab && !mediaInfo.tabId) {
      mediaInfo.tabId = sender.tab.id;
    }

    // Convert to MediaInfo instance if it's a plain object
    if (!(mediaInfo instanceof MediaInfo)) {
      mediaInfo = MediaInfo.from(mediaInfo.url, mediaInfo.type, mediaInfo.size, mediaInfo.tabId, mediaInfo.timestamp, mediaInfo.source);
    }

    // Add to store (handles duplicates)
    mediaStore.addMedia(mediaInfo);
    logger.info('DOM detected media:', mediaInfo);
    sendResponse({ received: true });
    return true; // Keep message channel open for async response
  }
});

// Handle bilibili video page detection and API calls
async function handleBilibiliVideo(url, tabId) {
  // Check if this is a bilibili video page
  const videoPage = MediaDetector.extractBilibiliVideoPage(url);
  if (!videoPage) {
    return;
  }

  try {
    // Fetch the MP4 URL from the API
    const mp4Url = await MediaDetector.fetchBilibiliVideoUrl(videoPage.apiBvCode);

    if (!mp4Url) {
      logger.warn('Failed to fetch bilibili video URL for BV:', videoPage.bvCode);
      return;
    }

    // Create media info for the MP4 URL
    const mediaInfo = MediaInfo.create({
      url: mp4Url,
      type: 'video',
      size: null, // API doesn't provide size
      tabId: tabId,
      timestamp: Date.now(),
      source: 'bilibili original' // Mark as coming from bilibili original video
    });

    // Add to media store (avoid duplicates)
    mediaStore.addMedia(mediaInfo);
    logger.info('Added bilibili video to media store:', mp4Url);
  } catch (error) {
    logger.warn('Error fetching bilibili video URL:', error);
  }
}

// --- HLS Download Logic Removed (Moved to Content Script) ---
// Service Workers cannot create ObjectURLs from Blobs efficiently in standard API.
