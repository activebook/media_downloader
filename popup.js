// Popup script to display media list and handle downloads

document.addEventListener('DOMContentLoaded', function() {
  const mediaList = document.getElementById('mediaList');
  const refreshBtn = document.getElementById('refreshBtn');
  const downloadAllBtn = document.getElementById('downloadAllBtn');
  const statusDiv = document.getElementById('status');

  // Load and display media on popup open
  loadMedia();

  // Refresh button handler
  refreshBtn.addEventListener('click', function() {
    statusDiv.textContent = 'Refreshing...';
    refreshBtn.disabled = true;

    chrome.runtime.sendMessage({ action: 'refresh' }, (response) => {
      if (response && response.status === 'refreshed') {
        statusDiv.textContent = 'Refreshed successfully';
        loadMedia();
      } else {
        statusDiv.textContent = 'Refresh failed';
      }
      refreshBtn.disabled = false;
      setTimeout(() => statusDiv.textContent = '', 3000);
    });
  });

  // Download All button handler
  downloadAllBtn.addEventListener('click', function() {
    downloadAllBtn.disabled = true;
    downloadAllBtn.textContent = 'Downloading...';

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
          downloadAllBtn.textContent = 'Download All';
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
              downloadAllBtn.disabled = false;
              downloadAllBtn.textContent = 'Download All';
              setTimeout(() => statusDiv.textContent = '', 5000);
            }
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
      mediaList.innerHTML = '<div class="no-media">No media detected yet. Try refreshing or interacting with the page.</div>';
      downloadAllBtn.style.display = 'none';
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
        mediaList.innerHTML = '<div class="no-media">No media found on this tab. Try refreshing.</div>';
        downloadAllBtn.style.display = 'none';
        return;
      }

      // Show Download All button if there is media
      downloadAllBtn.style.display = 'inline-block';

      currentTabMedia.forEach(media => {
        const mediaItem = createMediaItem(media);
        mediaList.appendChild(mediaItem);
      });
    });
  }

  function createMediaItem(media) {
    const item = document.createElement('div');
    item.className = 'media-item';

    const info = document.createElement('div');
    info.className = 'media-info';

    const type = document.createElement('div');
    type.className = 'media-type';
    type.textContent = media.type;

    const url = document.createElement('div');
    url.className = 'media-url';
    url.textContent = media.url;

    const size = document.createElement('div');
    size.className = 'media-size';
    size.textContent = formatSize(media.size);

    info.appendChild(type);
    info.appendChild(url);
    info.appendChild(size);

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'download-btn';
    downloadBtn.textContent = 'Download';
    downloadBtn.addEventListener('click', () => downloadMedia(media.url, downloadBtn));

    item.appendChild(info);
    item.appendChild(downloadBtn);

    return item;
  }

  function downloadMedia(url, button) {
    button.disabled = true;
    button.textContent = 'Downloading...';

    chrome.downloads.download({
      url: url,
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('Download failed:', chrome.runtime.lastError);
        statusDiv.textContent = 'Download failed: ' + chrome.runtime.lastError.message;
        button.disabled = false;
        button.textContent = 'Download';
      } else {
        statusDiv.textContent = 'Download started';
        button.textContent = 'Downloaded';
        setTimeout(() => {
          button.disabled = false;
          button.textContent = 'Download';
        }, 2000);
      }
      setTimeout(() => statusDiv.textContent = '', 5000);
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