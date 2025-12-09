// Content script for downloading videos from page context
// This runs in the context of the web page and has access to the page's cookies

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'downloadVideoFromPage') {
        downloadVideoInPageContext(request.url, request.filename)
            .then(() => {
                sendResponse({ success: true });
            })
            .catch((error) => {
                sendResponse({ success: false, error: error.message });
            });
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
        console.error('Content script download failed:', error);
        throw error;
    }
}

// --- DOM Media Detection Logic ---

function scanForMedia() {
    // Find all video and audio elements
    const mediaElements = document.querySelectorAll('video, audio');

    mediaElements.forEach(element => {
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

            // Check if it's already reported? We send it, background de-dupes.

            const type = element.tagName.toLowerCase() === 'video' ? 'video/mp4' : 'audio/mp3'; // Guess fallback

            // Check if extension context is valid
            if (chrome.runtime?.id) {
                try {
                    chrome.runtime.sendMessage({
                        action: 'mediaDetected',
                        mediaInfo: {
                            url: src,
                            type: type,
                            size: 'Unknown',
                            timestamp: Date.now(),
                            source: 'blob'
                        }
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            // Ignored: Receiver might not exist or other runtime error
                        }
                    });
                } catch (e) {
                    console.log('Extension context invalidated, stopping scan reports.');
                }
            }
        }
    });
}

// --- HLS Download Logic ---
// Implemented in content script to have access to DOM APIs like URL.createObjectURL

// HLS State Tracking
let hlsAbortController = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Ensure only the main frame processes the download to avoid duplicates (since content script runs in all frames)
    if (window !== window.top) {
        return;
    }

    if (request.action === 'downloadHLS') {
        // Cancel any existing download first
        if (hlsAbortController) {
            hlsAbortController.abort();
        }
        hlsAbortController = new AbortController();

        // Initialize state and respond immediately so UI can switch
        const initialState = {
            isDownloading: true,
            status: 'downloading',
            url: request.url,
            filename: request.filename,
            downloadedSegments: 0,
            totalSegments: 0
        };

        chrome.storage.local.set({ hlsDownloadState: initialState }, () => {
            if (chrome.runtime.lastError) {
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
                return;
            }

            // Respond success to popup so it redirects
            sendResponse({ success: true });

            // Start the actual download process asynchronously
            downloadHLSInPage(request.url, request.filename, hlsAbortController.signal)
                .catch(err => {
                    console.error('HLS Download failed:', err);
                    // Update state to error since we already told popup it started
                    chrome.storage.local.get(['hlsDownloadState'], (result) => {
                        if (!result.hlsDownloadState) {
                            chrome.storage.local.set({
                                hlsDownloadState: {
                                    isDownloading: false,
                                    status: 'error',
                                    error: err.message,
                                    url: request.url
                                }
                            });
                        }
                    });
                });
        });

        return true; // Keep channel open for the storage set callback
    } else if (request.action === 'cancelHLSDownload') {
        if (hlsAbortController) {
            hlsAbortController.abort();
            hlsAbortController = null;
        }

        // Just report success, the loop in downloadHLSInPage will catch the flag
        sendResponse({ success: true });
        return true;
    }
});

async function downloadHLSInPage(url, filename, signal) {
    const updateState = (state) => {
        // Check if aborted BEFORE updating
        if (signal.aborted) {
            console.log('Signal aborted, skipping state update');
            return;
        }
        // check whether hlsDownloadState is removed or not
        chrome.storage.local.get(['hlsDownloadState'], (result) => {
            if (!result.hlsDownloadState) {
                console.log('hlsDownloadState not found, aborting state update');
                return;
            }
            chrome.storage.local.set({ hlsDownloadState: state });
        });
    };

    try {
        console.log('Starting HLS download (Content Script) for:', url);

        // 1. Fetch the playlist
        const response = await fetch(url, { signal });
        if (!response.ok) throw new Error(`Failed to fetch playlist: ${response.status}`);
        let playlistText = await response.text();

        // 2. Check if Master Playlist (contains other m3u8 links)
        if (playlistText.includes('#EXT-X-STREAM-INF')) {
            console.log('Detected Master Playlist, resolving best stream...');
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
                console.log(`Switching to best stream (Bandwidth: ${maxBandwidth}):`, bestUrl);
                return downloadHLSInPage(bestUrl, filename, signal);
            }
        }

        // 3. Parse Segments
        const lines = playlistText.split('\n');
        const segmentUrls = [];

        for (let line of lines) {
            line = line.trim();
            if (line && !line.startsWith('#')) {
                segmentUrls.push(resolveUrl(url, line));
            }
        }

        if (segmentUrls.length === 0) {
            throw new Error('No segments found in playlist');
        }

        console.log(`Found ${segmentUrls.length} segments. Starting download...`);
        updateState({
            isDownloading: true,
            status: 'downloading',
            url: url,
            filename: filename,
            downloadedSegments: 0,
            totalSegments: segmentUrls.length
        });

        // 4. Download Segments
        const chunks = [];
        const BATCH_SIZE = 5;

        for (let i = 0; i < segmentUrls.length; i += BATCH_SIZE) {
            // ✅ CHECK ABORT SIGNAL AT START OF EACH BATCH
            if (signal.aborted) {
                console.log('Download cancelled during segment download');
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
                console.log(`Downloaded ${downloadedCount}/${segmentUrls.length} segments`);

                // ✅ This updateState will check signal.aborted and throw if cancelled
                updateState({
                    isDownloading: true,
                    status: 'downloading',
                    url: url,
                    filename: filename,
                    downloadedSegments: downloadedCount,
                    totalSegments: segmentUrls.length
                });

            } catch (err) {
                if (err.name === 'AbortError') throw err; // Re-throw cancel signal to outer block
                console.error('Error fetching segment batch:', err);
                throw new Error('Failed to download some segments');
            }
        }

        // 5. Merge
        console.log('Merging segments...');

        // Check if cancelled before merging
        if (signal.aborted) {
            console.log('Download cancelled before merging');
            const err = new Error('Download cancelled by user');
            err.name = 'AbortError';
            throw err;
        }

        updateState({
            isDownloading: true,
            status: 'merging',
            url: url,
            filename: filename,
            downloadedSegments: segmentUrls.length,
            totalSegments: segmentUrls.length
        });

        const combinedBlob = new Blob(chunks, { type: 'video/mp2t' });

        // 6. Download using DOM
        console.log('Triggering DOM download...');

        const blobUrl = URL.createObjectURL(combinedBlob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename || 'video.ts';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();

        updateState({
            isDownloading: false,
            status: 'complete',
            url: url,
            filename: filename,
            downloadedSegments: segmentUrls.length,
            totalSegments: segmentUrls.length
        });

        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
        }, 10000);

        console.log('HLS Download complete');
        return true;

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('⛔ Download cancelled - no state update');
            // ✅ Don't update storage at all
            return;
        }

        // Real error
        console.error('❌ HLS Error:', error);
        updateState({
            isDownloading: false,
            status: 'error',
            error: error.message,
            url: url
        });
        throw error;
    }
}

function resolveUrl(baseUrl, relativeUrl) {
    if (relativeUrl.startsWith('http')) return relativeUrl;
    try {
        return new URL(relativeUrl, baseUrl).href;
    } catch (e) {
        return relativeUrl;
    }
}

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
