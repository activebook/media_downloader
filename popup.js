// Popup script to display media list and handle downloads

document.addEventListener('DOMContentLoaded', function() {
  // Define button HTML structures as constants
  const DOWNLOAD_BTN_HTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
    <span>Fetch</span>
  `;
  
  const DOWNLOADING_BTN_HTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
    <span>Downloading...</span>
  `;

  // Original code starts here
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

  // Check license status on load
  checkLicenseStatus();

  function checkLicenseStatus() {
    isLicenseActivated(skip=false, (activated) => {
      if (activated) {
        showMainContent();
        loadMedia();
      } else {
        getLicenseKey((key) => {
          showLicenseSection(key);
        });
      }
    });
  }

  function showLicenseSection(key) {
    licenseSection.style.display = 'block';
    mainContent.style.display = 'none';
    uniqueKeySpan.textContent = key;
    
    // Add event listener for copy button if it exists
    if (copyKeyBtn) {
      copyKeyBtn.addEventListener('click', copyUniqueKeyToClipboard);
    }
  }

  function showMainContent() {
    licenseSection.style.display = 'none';
    mainContent.style.display = 'block';
  }

  // Activation handler
  activateBtn.addEventListener('click', async function() {
    const pass = licenseInput.value.trim();
    if (!pass) {
      licenseStatus.textContent = 'Please enter a pass';
      licenseStatus.className = 'text-sm text-red-600 mt-4';
      return;
    }

    licenseStatus.textContent = 'Verifying...';
    licenseStatus.className = 'text-sm text-blue-600 mt-4';

    try {
      const success = await activateLicense(pass);
      if (success) {
        licenseStatus.textContent = 'License activated successfully!';
        licenseStatus.className = 'text-sm text-green-600 mt-4';
        setTimeout(() => {
          showMainContent();
          loadMedia();
        }, 1500);
      } else {
        licenseStatus.textContent = 'Invalid pass. Please try again.';
        licenseStatus.className = 'text-sm text-red-600 mt-4';
      }
    } catch (error) {
      licenseStatus.textContent = 'Verification failed. Please try again.';
      licenseStatus.className = 'text-sm text-red-600 mt-4';
      console.error('License activation error:', error);
    }
  });

  // Load and display media on popup open
  loadMedia();

  // Refresh button handler
  refreshBtn.addEventListener('click', function() {
    statusDiv.textContent = 'Refreshing...';
    refreshBtn.disabled = true;

    chrome.runtime.sendMessage({ action: 'refresh' }, (response) => {
      if (response && response.status === 'refreshed') {
        statusDiv.textContent = 'Refreshed successfully';
        statusDiv.className = 'text-sm text-green-600 mt-2';
        loadMedia();
      } else {
        statusDiv.textContent = 'Refresh failed';
        statusDiv.className = 'text-sm text-red-600 mt-2';
      }
      refreshBtn.disabled = false;
      setTimeout(() => {
        statusDiv.textContent = '';
        statusDiv.className = 'text-sm text-gray-600 mt-2';
      }, 3000);
    });
  });

  // Download All button handler
  downloadAllBtn.addEventListener('click', function() {
    // Check license before allowing download
    isLicenseActivated(skip=true, (activated) => {
      if (!activated) {
        statusDiv.textContent = 'License not activated. Please activate first.';
        statusDiv.className = 'text-sm text-red-600 mt-2';
        setTimeout(() => {
          statusDiv.textContent = '';
          statusDiv.className = 'text-sm text-gray-600 mt-2';
        }, 3000);
        return;
      }

      downloadAllBtn.disabled = true;
      downloadAllBtn.innerHTML = DOWNLOADING_BTN_HTML;

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTabId = tabs[0]?.id;
        chrome.storage.local.get(['mediaStore'], (result) => {
          const mediaStore = result.mediaStore || [];
          const mediaMap = new Map(mediaStore);
          const currentTabMedia = Array.from(mediaMap.values())
            .filter(media => media.tabId === activeTabId)
            .sort((a, b) => b.timestamp - a.timestamp);

          if (currentTabMedia.length === 0) {
            statusDiv.textContent = 'No media to download';
            downloadAllBtn.disabled = false;
            downloadAllBtn.innerHTML = DOWNLOAD_BTN_HTML;
            statusDiv.className = 'text-sm text-gray-600 mt-2';
            setTimeout(() => statusDiv.textContent = '', 3000);
            return;
          }

          let downloadCount = 0;
          const totalDownloads = currentTabMedia.length;

          currentTabMedia.forEach(media => {
            chrome.downloads.download({
              url: media.url,
              saveAs: false
            }, (downloadId) => {
              downloadCount++;
              if (downloadCount === totalDownloads) {
                statusDiv.textContent = `Downloaded ${totalDownloads} files`;
                statusDiv.className = 'text-sm text-green-600 mt-2';
                downloadAllBtn.disabled = false;
                downloadAllBtn.innerHTML = DOWNLOAD_BTN_HTML;
                setTimeout(() => {
                  statusDiv.textContent = '';
                  statusDiv.className = 'text-sm text-gray-600 mt-2';
                }, 5000);
              }
            });
          });
        });
      });
    });
  });

  // Listen for storage changes to update list in real-time
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (changes.mediaStore) {
      loadMedia();
    }
  });

  function loadMedia() {
    chrome.storage.local.get(['mediaStore'], (result) => {
      const mediaStore = result.mediaStore || [];
      displayMedia(mediaStore);
    });
  }

  function displayMedia(mediaStore) {
    mediaList.innerHTML = '';

    if (mediaStore.length === 0) {
      mediaList.innerHTML = '<div class="text-center text-gray-500 py-8">No media detected yet. Try refreshing or interacting with the page.</div>';
      downloadAllBtn.classList.add('hidden');
      return;
    }

    // Convert back to Map and filter for current tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTabId = tabs[0]?.id;
      const mediaMap = new Map(mediaStore);

      // Filter media for current tab and sort by timestamp (newest first)
      const currentTabMedia = Array.from(mediaMap.values())
        .filter(media => media.tabId === activeTabId)
        .sort((a, b) => b.timestamp - a.timestamp);

      if (currentTabMedia.length === 0) {
        mediaList.innerHTML = '<div class="text-center text-gray-500 py-8">No media found on this tab. Try refreshing.</div>';
        downloadAllBtn.classList.add('hidden');
        return;
      }

      // Show Download All button if there is media
      downloadAllBtn.classList.remove('hidden');

      currentTabMedia.forEach(media => {
        const mediaItem = createMediaItem(media);
        mediaList.appendChild(mediaItem);
      });
    });
  }

  function createMediaItem(media) {
    const item = document.createElement('div');
    item.className = 'flex justify-between items-center p-3 bg-white border border-gray-200 rounded-md shadow-sm';

    const info = document.createElement('div');
    info.className = 'flex-1 mr-3';

    const type = document.createElement('div');
    type.className = 'font-bold text-gray-800';
    type.textContent = media.type;

    const url = document.createElement('div');
    url.className = 'text-xs text-gray-500 break-all mt-1';
    url.textContent = media.url;

    const size = document.createElement('div');
    size.className = 'text-xs text-gray-400 mt-1';
    size.textContent = formatSize(media.size);

    info.appendChild(type);
    info.appendChild(url);
    info.appendChild(size);

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded-md text-xs font-medium transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed';
    downloadBtn.textContent = 'Download';
    downloadBtn.addEventListener('click', () => downloadMedia(media.url, downloadBtn));

    item.appendChild(info);
    item.appendChild(downloadBtn);

    return item;
  }

  function downloadMedia(url, button) {
    // Check license before allowing download
    isLicenseActivated(skip=true, (activated) => {
      if (!activated) {
        statusDiv.textContent = 'License not activated. Please activate first.';
        statusDiv.className = 'text-sm text-red-600 mt-2';
        setTimeout(() => {
          statusDiv.textContent = '';
          statusDiv.className = 'text-sm text-gray-600 mt-2';
        }, 3000);
        return;
      }

      button.disabled = true;
      button.textContent = 'Downloading...';

      chrome.downloads.download({
        url: url,
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error('Download failed:', chrome.runtime.lastError);
          statusDiv.textContent = 'Download failed: ' + chrome.runtime.lastError.message;
          statusDiv.className = 'text-sm text-red-600 mt-2';
          button.disabled = false;
          button.textContent = 'Download';
        } else {
          statusDiv.textContent = 'Download started';
          statusDiv.className = 'text-sm text-green-600 mt-2';
          button.textContent = 'Downloaded';
          setTimeout(() => {
            button.disabled = false;
            button.textContent = 'Download';
          }, 2000);
        }
        setTimeout(() => {
          statusDiv.textContent = '';
          statusDiv.className = 'text-sm text-gray-600 mt-2';
        }, 5000);
      });
    });
  }

  function formatSize(size) {
    if (size === 'Unknown' || !size) return 'Size: Unknown';
    const bytes = parseInt(size);
    if (bytes < 1024) return `Size: ${bytes} B`;
    if (bytes < 1024 * 1024) return `Size: ${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `Size: ${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `Size: ${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
});