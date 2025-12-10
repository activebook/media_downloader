// Content script for downloading videos from page context
// This runs in the context of the web page and has access to the page's cookies

const logger = new ExtensionLogger('Content');

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.action === REQUEST_ACTION_DOWNLOAD_VIDEO_FROM_PAGE) {
        try {
            await downloadVideoInPageContext(request.url, request.filename);
            sendResponse({ success: true });
        } catch (error) {
            sendResponse({ success: false, error: error.message });
        }
        return true; // Keep message channel open for async response
    }
});

async function downloadVideoInPageContext(url, filename) {
    try {
        // Create a temporary anchor element
        const link = document.createElement('a');
        link.href = url;
        link.download = filename || 'video.mp4';
        link.target = '_blank'; // Prevent replacing current page
        link.rel = 'noopener noreferrer'; // Security best practice
        link.style.display = 'none';

        // Add to page
        document.body.appendChild(link);

        // Trigger click to download
        link.click();

        // Clean up after a short delay
        setTimeout(() => {
            if (link.parentNode) {
                document.body.removeChild(link);
            }
        }, 100);

        return true;
    } catch (error) {
        logger.warn('Content script download failed:', error);
        throw error;
    }
}

// --- DOM Media Detection Logic ---

async function scanForMedia() {
    if (!extensionContextValid()) {
        logger.info('Extension context invalidated, stopping scan reports just now, try again later.');
        return;
    }

    // Find all video and audio elements
    const mediaElements = document.querySelectorAll('video, audio');

    mediaElements.forEach(async (element) => {
        let src = element.currentSrc || element.src;
        if (!src && element.querySelector('source')) {
            src = element.querySelector('source').src;
        }

        // Skip if no src or if it's a blob/mediasource (which we might not be able to download easily via simple link)
        // However, for this task, we want to catch mp4s mostly.
        if (src && (src.startsWith('http') || src.startsWith('blob:'))) {
            // For blob: URLs, we can't download them directly usually, but report them anyway
            // The extension might handle them or user might want to know.
            // But the main goal is standard files.
            const type = element.tagName.toLowerCase() === 'video' ? 'video' : 'audio'; // Guess fallback            
            try {
                const media = MediaInfo.create({
                    url: src,
                    type: type,
                    size: null,
                    timestamp: Date.now(),
                    source: 'blob'
                });
                // It would check if extension context is valid
                await sendBroadcast({
                    action: REQUEST_ACTION_MEDIA_DETECTED,
                    mediaInfo: media
                });
            } catch (e) {
                logger.warn(e.message);
            }
        }
    });
}

// --- HLS Download Logic ---
// Implemented in content script to have access to DOM APIs like URL.createObjectURL

/**
 * Parse M3U8 playlist content to extract segment URLs
 * @param {string} playlistText - The M3U8 playlist content
 * @param {string} url - The URL of the playlist for resolving relative URLs
 * @returns {{segmentUrls: string[], effectiveUrl: string}} Object containing segment URLs and the effective playlist URL
 */
function parseM3U8Segments(playlistText, url) {
    // Check if Master Playlist (contains other m3u8 links)
    if (playlistText.includes('#EXT-X-STREAM-INF')) {
        logger.info('Detected Master Playlist, resolving best stream...');
        const lines = playlistText.split('\n');
        let bestUrl = null;
        let maxBandwidth = 0;

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
                const bandwidthMatch = lines[i].match(/BANDWIDTH=(\d+)/);
                const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1]) : 0;

                let streamUrl = lines[i + 1];
                if (streamUrl && !streamUrl.startsWith('#')) {
                    if (bandwidth > maxBandwidth) {
                        maxBandwidth = bandwidth;
                        bestUrl = resolveUrl(url, streamUrl);
                    }
                }
            }
        }

        if (bestUrl) {
            logger.info(`Switching to best stream (Bandwidth: ${maxBandwidth}):`, bestUrl);
            return { segmentUrls: null, effectiveUrl: bestUrl }; // Need to refetch
        }
    }

    // Parse Segments for regular playlist
    const lines = playlistText.split('\n');
    const segmentUrls = [];

    for (let line of lines) {
        line = line.trim();
        if (line && !line.startsWith('#')) {
            segmentUrls.push(resolveUrl(url, line));
        }
    }

    return { segmentUrls, effectiveUrl: url };
}

/**
 * Fetch playlist content from URL with signal support
 * @param {string} url - The playlist URL to fetch
 * @param {AbortSignal} signal - Abort signal for cancellation
 * @returns {Promise<string>} The playlist text content
 */
async function fetchPlaylist(url, signal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Failed to fetch playlist: ${response.status}`);
    return await response.text();
}

/**
 * Download segments from URLs in batches with progress updates
 * @param {string[]} segmentUrls - Array of segment URLs to download
 * @param {AbortSignal} signal - Abort signal for cancellation
 * @param {DownloadState} downloadState - Download state for progress updates
 * @returns {Promise<ArrayBuffer[]>} Array of downloaded chunk buffers
 */
async function downloadSegments(segmentUrls, signal, downloadState) {
    const chunks = [];
    const BATCH_SIZE = 5;

    for (let i = 0; i < segmentUrls.length; i += BATCH_SIZE) {
        // ✅ CHECK ABORT SIGNAL AT START OF EACH BATCH
        logger.info('Starting batch, signal.aborted:', signal.aborted);
        if (signal.aborted) {
            logger.info('Download cancelled during segment download');
            const err = new Error('Download cancelled by user');
            err.name = 'AbortError';
            throw err;
        }

        const batch = segmentUrls.slice(i, i + BATCH_SIZE);
        const promises = batch.map(segUrl => fetch(segUrl, { signal }).then(res => res.arrayBuffer()));

        try {
            const buffers = await Promise.all(promises);
            chunks.push(...buffers);

            const downloadedCount = Math.min(i + BATCH_SIZE, segmentUrls.length);
            logger.info(`Downloaded ${downloadedCount}/${segmentUrls.length} segments`);

            await downloadState.updateProgress(downloadedCount, segmentUrls.length);

        } catch (err) {
            if (err.name === 'AbortError') throw err; // Re-throw cancel signal to outer block
            logger.warn('Error fetching segment batch:', err);
            throw new Error('Failed to download some segments');
        }
    }

    return chunks;
}

/**
 * Resolve a relative URL to an absolute URL
 * @param {string} baseUrl - The base URL to resolve against
 * @param {string} relativeUrl - The relative URL to resolve
 * @returns {string} The resolved absolute URL
 */
function resolveUrl(baseUrl, relativeUrl) {
    if (relativeUrl.startsWith('http')) return relativeUrl;
    try {
        return new URL(relativeUrl, baseUrl).href;
    } catch (e) {
        return relativeUrl;
    }
}

// HLS State Tracking
let hlsAbortController = null;

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.action === REQUEST_ACTION_DOWNLOAD_HLS) {
        // Ensure only the main frame processes the download to avoid duplicates (since content script runs in all frames)
        if (window !== window.top) {
            return;
        }

        // Cancel any existing download first
        if (hlsAbortController) {
            hlsAbortController.abort();
        }
        hlsAbortController = new AbortController();

        // Initialize state and respond immediately so UI can switch
        try {
            let downloadState = new DownloadState(request.url, request.filename, request.tabId);
            await downloadState.start();
            sendResponse({ success: true });

            // Start the actual download process asynchronously
            await downloadHLSInPage(downloadState, hlsAbortController.signal);
        } catch (error) {
            logger.warn('HLS Start/Download failed:', error);
            // Try sending failure if possible
            try {
                sendResponse({ success: false, error: error.message });
            } catch (e) { }
        }


        return true; // Keep channel open for async response
    }

    if (request.action === REQUEST_ACTION_CANCEL_HLS_DOWNLOAD) {
        logger.info('Cancel HLS download requested');
        if (hlsAbortController) {
            logger.info('Aborting HLS controller');
            hlsAbortController.abort();
            hlsAbortController = null;
        }
        // Just report success, the loop in downloadHLSInPage will catch the flag
        sendResponse({ success: true });
        return true;
    }
});

async function downloadHLSInPage(downloadState, signal) {
    // Extract url and filename for convenience
    let url = downloadState.url;
    const filename = downloadState.filename;

    try {
        logger.info('Starting HLS download (Content Script) for:', url);

        // Fetch and parse the playlist
        let playlistText = await fetchPlaylist(url, signal);

        // Parse segments, handling master playlists
        let parseResult = parseM3U8Segments(playlistText, url);
        while (!parseResult.segmentUrls) {
            // Master playlist detected, fetch the best stream
            playlistText = await fetchPlaylist(parseResult.effectiveUrl, signal);
            parseResult = parseM3U8Segments(playlistText, parseResult.effectiveUrl);
        }

        const segmentUrls = parseResult.segmentUrls;
        if (segmentUrls.length === 0) {
            throw new Error('No segments found in playlist');
        }

        // Update the download state with the effective URL
        downloadState.url = parseResult.effectiveUrl;

        logger.info(`Found ${segmentUrls.length} segments. Starting download...`);
        await downloadState.updateProgress(0, segmentUrls.length);

        // Download Segments
        const chunks = await downloadSegments(segmentUrls, signal, downloadState);

        // Merge
        logger.info('Merging segments...');
        await downloadState.startMerging();

        const combinedBlob = new Blob(chunks, { type: 'video/mp2t' });

        // Download using DOM
        logger.info('Triggering auto download...');

        const blobUrl = URL.createObjectURL(combinedBlob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename || 'video.ts';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();

        await downloadState.complete();

        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
        }, 10000);

        logger.info('HLS Download complete');
        return true;

    } catch (error) {
        if (error.name === 'AbortError') {
            logger.info('⛔ Download cancelled - no state update');
            // ✅ Don't update storage at all
            return;
        }

        // Real error
        logger.warn('❌ HLS Error:', error);
        await downloadState.fail(error.message);
        throw error;
    }
}

/*
 * This code implements a "belt and suspenders" approach to detecting media on a webpage.
 * It uses two different strategies simultaneously to ensure it never misses a media element 
 * (like a video or audio player), even if one method fails.
 */

// Initial scan
scanForMedia();

// Watch for changes/new media
const observer = new MutationObserver((mutations) => {
    let shouldScan = false;
    for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
            shouldScan = true;
            break;
        }
        if (mutation.type === 'attributes' && (mutation.attributeName === 'src' || mutation.attributeName === 'currentSrc')) {
            shouldScan = true;
            break;
        }
    }

    if (shouldScan) {
        scanForMedia();
    }
});

observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'currentSrc']
});

// Periodic scan fallback
setInterval(scanForMedia, 5000);
