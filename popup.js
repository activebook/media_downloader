// Popup script to display media list and handle downloads

document.addEventListener('DOMContentLoaded', function () {
  // Define button HTML structures as constants
  const DOWNLOAD_BTN_HTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>

  `;

  const DOWNLOADING_SPINNER_HTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-spin">
      <line x1="12" y1="2" x2="12" y2="6"></line>
      <line x1="12" y1="18" x2="12" y2="22"></line>
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
      <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
      <line x1="2" y1="12" x2="6" y2="12"></line>
      <line x1="18" y1="12" x2="22" y2="12"></line>
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
      <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
    </svg>

  `;

  const DEFAULT_STATUS_TEXT = 'Refresh to scan for media or use Fetch to download all';

  const logger = new ExtensionLogger('Popup');
  const mediaStore = new MediaStore();

  // DOM Elements
  const mediaList = document.getElementById('mediaList');
  const refreshBtn = document.getElementById('refreshBtn');
  const downloadAllBtn = document.getElementById('downloadAllBtn');
  const statusDiv = document.getElementById('status');
  const licenseSection = document.getElementById('licenseSection');
  const mainContent = document.getElementById('mainContent');
  const uniqueKeySpan = document.getElementById('uniqueKey');
  const licenseInput = document.getElementById('licenseInput');
  const activateBtn = document.getElementById('activateBtn');
  const licenseStatus = document.getElementById('licenseStatus');
  const copyKeyBtn = document.getElementById('copyKeyBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const versionSpan = document.getElementById('version');


  // Initialization
  initialize();

  function initialize() {
    // Check for active download state immediately
    checkDownloadState();

    // Check license status on load
    checkLicenseStatus();

    // Event Listeners
    activateBtn.addEventListener('click', handleActivation);
    refreshBtn.addEventListener('click', handleRefresh);
    downloadAllBtn.addEventListener('click', () => {
      checkLicenseAndExecute(handleDownloadAll);
    });
    settingsBtn.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });

    // Display version
    const manifest = chrome.runtime.getManifest();
    versionSpan.textContent = `v${manifest.version}`;


    // Listen for storage changes
    chrome.storage.onChanged.addListener(handleStorageChange);

    // Set up event delegation for download buttons to prevent multiple downloads
    setupEventDelegation();

    // Initial media load removed here as it is handled by checkLicenseStatus
  }

  function checkDownloadState() {
    chrome.storage.local.get(['hlsDownloadState'], (result) => {
      const state = result.hlsDownloadState;
      if (state && state.isDownloading) {
        window.location.replace('download.html');
      }
    });
  }

  function checkLicenseStatus() {
    isLicenseActivated(false, (activated) => { // false = don't skip check
      if (activated) {
        showMainContent();
        loadMedia();
      } else {
        getLicenseKey(showLicenseSection);
      }
    });
  }

  // Helper to wrap license check before actions
  function checkLicenseAndExecute(actionCallback) {
    isLicenseActivated(true, (activated) => { // true = skip server check if cached
      if (!activated) {
        showStatus('License not activated. Please activate first.', 'red');
        return;
      }
      actionCallback();
    });
  }

  // --- Event Handlers ---

  async function handleActivation() {
    const pass = licenseInput.value.trim();
    if (!pass) {
      updateLicenseStatus('Please enter a pass', 'text-red-600');
      return;
    }

    updateLicenseStatus('Verifying...', 'text-blue-600');

    try {
      const success = await activateLicense(pass);
      if (success) {
        updateLicenseStatus('License activated successfully!', 'text-green-600');
        setTimeout(() => {
          showMainContent();
          loadMedia();
        }, 1500);
      } else {
        updateLicenseStatus('Invalid pass. Please try again.', 'text-red-600');
      }
    } catch (error) {
      updateLicenseStatus('Verification failed. Please try again.', 'text-red-600');
      logger.warn('License activation error:', error);
    }
  }

  async function handleRefresh() {
    statusDiv.textContent = 'Refreshing...';
    refreshBtn.disabled = true;

    try {
      // Send message using common constant
      const response = await sendBroadcast({ action: REQUEST_ACTION_MEDIA_REFRESH });
      if (response && response.status === 'refreshed') {
        showStatus('Refreshed successfully', 'green');
        loadMedia();
      } else {
        showStatus('Refresh failed', 'red');
      }
      refreshBtn.disabled = false;
    } catch (e) {
      showStatus('Refresh failed: ' + e.message, 'red');
      refreshBtn.disabled = false;
    }
  }

  async function handleDownloadAll() {
    downloadAllBtn.disabled = true;
    downloadAllBtn.classList.add('opacity-75');
    downloadAllBtn.innerHTML = DOWNLOADING_SPINNER_HTML;

    try {
      const activeTabId = await getActiveTabId();

      // Get settings to filter media
      const showBlob = await getShowBlobSetting();
      const showSegment = await getShowSegmentSetting();

      // Filter based on settings
      let currentTabMedia = mediaStore.getMediaForTabFilter(activeTabId, showBlob, showSegment);

      if (currentTabMedia.length === 0) {
        showStatus('No media to download', 'gray');
        resetDownloadAllBtn();
        return;
      }

      await processBatchDownload(activeTabId, currentTabMedia);

    } catch (error) {
      logger.warn('Download All error:', error);
      showStatus('Error starting downloads', 'red');
      resetDownloadAllBtn();
    }
  }

  async function processBatchDownload(activeTabId, mediaList) {
    let downloadCount = 0;
    const totalDownloads = mediaList.length;

    const updateBatchProgress = () => {
      if (downloadCount === totalDownloads) {
        showStatus(`Downloaded ${totalDownloads} files`, 'green');
        resetDownloadAllBtn();
        setTimeout(() => showStatus(DEFAULT_STATUS_TEXT, 'gray'), 5000);
      }
    };

    // Parallel execution for all items
    const downloadPromises = mediaList.map(async (media) => {
      try {
        if (MediaDetector.isVideoType(media.type)) {
          await triggerContentScriptDownload(activeTabId, media.url, `video_${Date.now()}.mp4`);
        } else {
          await triggerDirectDownload(media.url);
        }
      } catch (e) {
        // Fallback or just log, then count as handled
        logger.warn('Batch download item failed:', e);
        // Try direct download as last resort if not already attempted
        if (MediaDetector.isVideoType(media.type)) {
          try { await triggerDirectDownload(media.url); } catch (err) { }
        }
      } finally {
        downloadCount++;
        updateBatchProgress();
      }
    });

    // We don't await Promise.all here because we want progress updates per item completion
    // But the updated logic above handles it via callback/finally
  }

  // Wrapper for content script download using shared helper
  async function triggerContentScriptDownload(tabId, url, filename) {
    try {
      const response = await sendMessage(tabId, {
        action: REQUEST_ACTION_DOWNLOAD_VIDEO_FROM_PAGE,
        url: url,
        filename: filename
      });

      if (!response || !response.success) {
        throw new Error(response?.error || 'Unknown error');
      }
    } catch (error) {
      // Re-throw to be caught by caller
      throw error;
    }
  }

  // Wrapper for direct download
  function triggerDirectDownload(url) {
    return new Promise((resolve) => {
      chrome.downloads.download({ url: url, saveAs: false }, (id) => {
        if (chrome.runtime.lastError) logger.warn("Direct DL failed", chrome.runtime.lastError);
        resolve(id);
      });
    });
  }


  function handleStorageChange(changes, namespace) {
    // Immediate redirect if download starts
    if (changes.hlsDownloadState && changes.hlsDownloadState.newValue?.isDownloading) {
      window.location.replace('download.html');
      return;
    }

    if (changes.mediaStore) {
      loadMedia();
    }
  }

  // --- UI Helpers ---

  function showStatus(text, color = 'gray') {
    statusDiv.textContent = text;
    // Map simple colors to Tailwind classes
    const colorMap = {
      'gray': 'text-gray-400',
      'green': 'text-green-600',
      'red': 'text-red-600',
      'blue': 'text-blue-600'
    };
    statusDiv.className = `text-sm ${colorMap[color] || colorMap['gray']} mt-2`;

    if (text === DEFAULT_STATUS_TEXT) return;

    // Auto-reset if it's a success/temporary message
    if (color === 'green' || color === 'red') {
      setTimeout(() => {
        statusDiv.textContent = DEFAULT_STATUS_TEXT;
        statusDiv.className = `text-sm ${colorMap['gray']} mt-2`;
      }, 3000);
    }
  }

  function updateLicenseStatus(text, className) {
    licenseStatus.textContent = text;
    licenseStatus.className = `text-sm ${className} mt-4`;
  }

  function showMainContent() {
    licenseSection.style.display = 'none';
    mainContent.style.display = 'block';
  }

  function showLicenseSection(key) {
    licenseSection.style.display = 'block';
    mainContent.style.display = 'none';
    uniqueKeySpan.textContent = key;
    if (copyKeyBtn) {
      copyKeyBtn.addEventListener('click', copyUniqueKeyToClipboard);
    }
  }

  function resetDownloadAllBtn() {
    downloadAllBtn.disabled = false;
    downloadAllBtn.classList.remove('opacity-75');
    downloadAllBtn.innerHTML = DOWNLOAD_BTN_HTML;
  }

  // --- Media Loading & Display ---

  async function loadMedia() {
    try {
      await mediaStore.loadFromStorage();
      displayMedia();
    } catch (error) {
      logger.warn('Failed to load media from storage:', error);
      displayMedia();
    }
  }

  async function displayMedia() {
    mediaList.innerHTML = '';

    const activeTabId = await getActiveTabId();

    // Get settings to filter media
    const showBlob = await getShowBlobSetting();
    const showSegment = await getShowSegmentSetting();

    // Filter based on settings
    let currentTabMedia = mediaStore.getMediaForTabFilter(activeTabId, showBlob, showSegment);

    if (currentTabMedia.length === 0) {
      mediaList.innerHTML = '<div class="text-center text-gray-500 py-8">No media detected yet. Try refreshing or interacting with the page.</div>';
      downloadAllBtn.classList.add('hidden');
      return;
    }

    // Show Download All button if there is media
    downloadAllBtn.classList.remove('hidden');

    currentTabMedia.forEach(media => {
      const mediaItem = createMediaItem(media);
      mediaList.appendChild(mediaItem);
    });
  }

  function createMediaItem(media) {
    const item = document.createElement('div');

    // Robust type detection
    const isBilibiliVideo = (media.source && media.source.toLowerCase().includes('bilibili')) || false;
    const isBlob = (media.source === 'blob') || (media.url && media.url.startsWith('blob:'));
    const isHLS = media.url.includes('.m3u8') || (media.type && (media.type.includes('mpegurl') || media.type.includes('hls')));
    const isHttpMedia = (media.source === 'http') || (media.url && media.url.startsWith('http'));

    // Item Styling
    if (isBilibiliVideo) {
      item.className = 'flex flex-col p-3 bg-gradient-to-r from-green-50 to-green-50 border-2 border-green-300 rounded-md shadow-md';
    } else if (isHLS) {
      item.className = 'flex flex-col p-3 bg-purple-50 border border-purple-200 rounded-md shadow-sm';
    } else if (isBlob) {
      // item.className = 'flex flex-col p-3 bg-blue-50 border border-blue-200 rounded-md shadow-sm';
      item.className = 'flex flex-col p-3 bg-gray-200 border border-gray-200 rounded-md shadow-sm';
    } else {
      item.className = 'flex justify-between items-center p-3 bg-white border border-gray-200 rounded-md shadow-sm';
    }

    // Info Row
    const infoRow = document.createElement('div');
    infoRow.className = 'flex justify-between items-center w-full';

    const info = document.createElement('div');
    info.className = 'flex-1 mr-3';

    // Type Label
    const type = document.createElement('div');
    if (isBilibiliVideo) {
      type.className = 'font-bold text-green-700 flex items-center';
      type.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="mr-1">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </svg>
        ${media.type}
      `;
    } else if (isHLS) {
      type.className = 'font-bold text-purple-700 flex items-center';
      type.innerHTML = 'HLS Stream (M3U8)';
    } else {
      type.className = 'font-bold text-gray-800';
      type.textContent = media.type;
    }

    // URL Label
    const url = document.createElement('div');
    url.className = 'text-xs text-blue-500 mt-1 cursor-pointer break-all';
    const fullUrl = media.url;
    const truncatedUrl = fullUrl.length > 50 ? fullUrl.substring(0, 50) + '...' : fullUrl;
    url.textContent = truncatedUrl;

    let isExpanded = false;
    url.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(fullUrl);
        showStatus('URL copied to clipboard', 'green');
      } catch (err) {
        logger.warn('Failed to copy URL: ', err);
      }
      isExpanded = !isExpanded;
      url.textContent = isExpanded ? fullUrl : truncatedUrl;
    });

    // Size Label
    const size = document.createElement('div');
    if (isBilibiliVideo) {
      size.className = 'text-xs text-cyan-600 mt-1 font-medium';
      size.textContent = `Source: ${media.source}`;
    } else if (isHttpMedia) {
      size.className = 'text-xs text-gray-400 mt-1';
      if (media.size) {
        size.textContent = `Size: ${MediaInfo.getFormattedSize(media)}`;
      } else {
        size.textContent = 'Calculating...';
        // Ask background script to get the size
        sendBroadcast({
          action: REQUEST_ACTION_MEDIA_GETSIZE,
          url: media.url
        }).then(response => {
          // console.log('Response:', response); // DEBUG
          if (response && response.size !== null) {
            media.size = response.size;
            // console.log('Set media.size to:', media.size); // DEBUG
            const formatted = MediaInfo.getFormattedSize(media);
            // console.log('Formatted size:', formatted); // DEBUG
            size.textContent = `Size: ${formatted}`;
          } else {
            size.textContent = 'Size: Unknown (Failed to fetch)';
          }
        }).catch(error => {
          size.textContent = 'Size: Unknown (Failed to fetch)';
          logger.warn('Size fetch error:', error);
        });
      }
    } else {
      size.className = 'text-xs text-gray-400 mt-1';
      size.textContent = `Size: ${MediaInfo.getFormattedSize(media)}`;
    }

    info.appendChild(type);
    info.appendChild(url);
    info.appendChild(size);

    infoRow.appendChild(info);

    // Download Button - Right Side
    // CRITICAL: Only show this button if NOT Blob and NOT Bilibili
    if (!isBlob && !isBilibiliVideo) {
      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded-md text-xs font-medium transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed whitespace-nowrap ml-2 media-download-btn';
      downloadBtn.textContent = isHLS ? 'Download .m3u8' : 'Download';
      // Store media data in attributes for event delegation
      downloadBtn.dataset.mediaUrl = media.url;
      downloadBtn.dataset.mediaType = media.type;
      infoRow.appendChild(downloadBtn);
    }

    item.appendChild(infoRow);

    // Bilibili Download Row (Bottom)
    if (isBilibiliVideo) {
      const biliRow = document.createElement('div');
      // Added margin-top (mt-2) and padding-top (pt-2) to separate from info
      biliRow.className = 'mt-2 pt-2 border-t border-green-200 w-full flex flex-col gap-2';

      const biliBtn = document.createElement('button');
      biliBtn.className = 'w-full bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-md text-xs font-medium transition-colors flex items-center justify-center media-download-btn';
      biliBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            Download
        `;
      biliBtn.dataset.mediaUrl = media.url;
      biliBtn.dataset.mediaType = media.type;

      biliRow.appendChild(biliBtn);
      item.appendChild(biliRow);
    }

    // Blob Download Row (Bottom)    
    if (isBlob) {
      // We can't download it, just hide the button

      const blobRow = document.createElement('div');
      blobRow.className = 'mt-2 pt-2 border-t border-blue-200 w-full flex flex-col gap-2';

      const blobBtn = document.createElement('button');
      blobBtn.className = 'w-full bg-gray-50 hover:bg-gray-100 text-gray-500 border border-gray-300 border-dashed px-2 py-1 rounded-md text-xs transition-colors flex items-center justify-center media-blob-download-btn';
      blobBtn.innerHTML = 'Download';
      // Store media data in attributes for event delegation
      blobBtn.dataset.mediaUrl = media.url;
      blobBtn.dataset.source = media.source || 'blob';

      blobRow.appendChild(blobBtn);
      item.appendChild(blobRow);

    }

    // HLS Merge Row (Bottom)
    if (isHLS) {
      const hlsRow = document.createElement('div');
      hlsRow.className = 'mt-2 pt-2 border-t border-purple-200 w-full flex flex-col gap-2';

      const mergeBtn = document.createElement('button');
      mergeBtn.className = 'w-full bg-purple-600 hover:bg-purple-700 text-white px-3 py-2 rounded-md text-xs font-medium transition-colors flex items-center justify-center media-hls-download-btn';
      mergeBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            Download
        `;
      // Store media data in attributes for event delegation
      mergeBtn.dataset.mediaUrl = media.url;
      mergeBtn.dataset.source = media.source || '';
      mergeBtn.dataset.timestamp = media.timestamp || Date.now();

      hlsRow.appendChild(mergeBtn);
      item.appendChild(hlsRow);
    }

    return item;
  }

  // --- Logic for Single Actions ---

  async function handleSingleDownload(url, mediaType, button) {
    if (MediaDetector.isVideoType(mediaType)) {
      await downloadVideoWithFetch(url, button);
    } else {
      triggerDirectDownloadWithUI(url, button);
    }
  }

  async function downloadVideoWithFetch(url, button) {
    try {
      updateBtnState(button, true, 'Fetching...');
      showStatus('Initiating download...', 'blue');

      const tabId = await getActiveTabId();
      if (!tabId) throw new Error('No active tab found');

      await triggerContentScriptDownload(tabId, url, `video_${Date.now()}.mp4`);

      showStatus('Download started', 'green');
      updateBtnState(button, true, 'Downloaded');

      setTimeout(() => {
        updateBtnState(button, false, 'Download');
        showStatus(DEFAULT_STATUS_TEXT, 'gray');
      }, 2000);
    } catch (error) {
      logger.warn('Content script download failed, fallback:', error);
      triggerDirectDownloadWithUI(url, button);
    }
  }

  function triggerDirectDownloadWithUI(url, button) {
    updateBtnState(button, true, 'Downloading...');

    chrome.downloads.download({ url: url, saveAs: false }, (id) => {
      if (chrome.runtime.lastError) {
        logger.warn('Download failed:', chrome.runtime.lastError);
        showStatus('Download failed: ' + chrome.runtime.lastError.message, 'red');
        updateBtnState(button, false, 'Download');
      } else {
        showStatus('Download started', 'green');
        updateBtnState(button, true, 'Downloaded');
        setTimeout(() => {
          updateBtnState(button, false, 'Download');
          showStatus(DEFAULT_STATUS_TEXT, 'gray');
        }, 2000);
      }
    });
  }

  function updateBtnState(button, disabled, text) {
    button.disabled = disabled;
    button.textContent = text;
  }

  async function handleMerge(media, mergeBtn) {
    mergeBtn.disabled = true;
    mergeBtn.innerHTML = 'Starting Download...';
    mergeBtn.className = 'w-full bg-gray-500 text-white px-3 py-2 rounded-md text-xs font-medium cursor-wait flex items-center justify-center';

    try {
      const activeTabId = await getActiveTabId();
      if (!activeTabId) {
        throw new Error('No Active Tab');
      }

      const response = await sendMessage(activeTabId, {
        action: REQUEST_ACTION_DOWNLOAD_HLS,
        url: media.url,
        filename: 'video_m3u8_' + Date.now() + '.ts',
        tabId: activeTabId
      });
      if (chrome.runtime.lastError) {
        handleMergeError(mergeBtn, chrome.runtime.lastError?.message);
      } else {
        window.location.replace('download.html');
      }
    } catch (e) {
      handleMergeError(mergeBtn, e.message);
    }
  }

  async function handleBlobDownload(url, source, blobBtn) {
    blobBtn.disabled = true;
    blobBtn.innerHTML = 'Starting Download...';
    blobBtn.className = 'w-full bg-gray-500 text-white px-3 py-2 rounded-md text-xs font-medium cursor-wait flex items-center justify-center';

    try {
      const activeTabId = await getActiveTabId();
      if (!activeTabId) {
        throw new Error('No Active Tab');
      }

      const response = await sendMessage(activeTabId, {
        action: REQUEST_ACTION_DOWNLOAD_BLOB,
        url: url,
        filename: 'blob_video_' + Date.now() + '.mp4'
      });
      if (chrome.runtime.lastError) {
        handleBlobError(blobBtn, chrome.runtime.lastError?.message);
      } else {
        showStatus('Blob download started', 'green');
        blobBtn.innerHTML = 'Downloaded';
      }
    } catch (e) {
      handleBlobError(blobBtn, e.message);
    }
  }

  function handleBlobError(btn, errorMsg) {
    btn.textContent = 'Failed (Reload Page)';
    btn.className = 'w-full bg-red-600 text-white px-3 py-2 rounded-md text-xs font-medium flex items-center justify-center';
    logger.warn(errorMsg);
    alert('Blob download failed: ' + errorMsg);

    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = 'Download';
      btn.className = 'w-full bg-gray-50 hover:bg-gray-100 text-gray-500 border border-gray-300 border-dashed px-2 py-1 rounded-md text-xs transition-colors flex items-center justify-center';
    }, 3000);
  }

  function handleMergeError(btn, errorMsg) {
    btn.textContent = 'Failed (Reload Page)';
    btn.className = 'w-full bg-red-600 text-white px-3 py-2 rounded-md text-xs font-medium flex items-center justify-center';
    logger.warn(errorMsg);
    alert('Extension updated/error, please refresh the page and try again');

    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = 'Download';
      btn.className = 'w-full bg-purple-600 hover:bg-purple-700 text-white px-3 py-2 rounded-md text-xs font-medium transition-colors flex items-center justify-center';
    }, 3000);
  }

  // --- Event Delegation for Download Buttons ---

  function setupEventDelegation() {
    // Remove existing event listener to prevent duplicates
    mediaList.removeEventListener('click', handleDelegatedClick);

    // Add single event listener to handle all download button clicks
    mediaList.addEventListener('click', handleDelegatedClick);
  }

  function handleDelegatedClick(event) {
    const target = event.target;

    // Handle regular download buttons (only for non-special media)
    if (target.classList.contains('media-download-btn') && !target.classList.contains('media-blob-download-btn')) {
      event.preventDefault();
      event.stopPropagation();

      const url = target.dataset.mediaUrl;
      const mediaType = target.dataset.mediaType;

      if (url && mediaType) {
        checkLicenseAndExecute(() => handleSingleDownload(url, mediaType, target));
      }
      return;
    }

    // Handle HLS merge buttons
    if (target.classList.contains('media-hls-download-btn') || target.closest('.media-hls-download-btn')) {
      event.preventDefault();
      event.stopPropagation();

      const btn = target.classList.contains('media-hls-download-btn') ? target : target.closest('.media-hls-download-btn');
      const url = btn.dataset.mediaUrl;
      const source = btn.dataset.source || 'HLS Stream';
      const timestamp = btn.dataset.timestamp || Date.now();

      if (url) {
        // Create a media object for handleMerge function
        const media = {
          url: url,
          source: source,
          timestamp: timestamp
        };
        checkLicenseAndExecute(() => handleMerge(media, btn));
      }
      return;
    }

    // Handle blob download buttons
    if (target.classList.contains('media-blob-download-btn') || target.closest('.media-blob-download-btn')) {
      event.preventDefault();
      event.stopPropagation();

      const btn = target.classList.contains('media-blob-download-btn') ? target : target.closest('.media-blob-download-btn');
      const url = btn.dataset.mediaUrl;
      const source = btn.dataset.source || 'blob';

      if (url) {
        checkLicenseAndExecute(() => handleBlobDownload(url, source, btn));
      }
      return;
    }
  }

});
