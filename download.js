document.addEventListener('DOMContentLoaded', () => {
    const filenameEl = document.getElementById('filename');
    const urlEl = document.getElementById('url');
    const statusBadge = document.getElementById('statusBadge');
    const percentageEl = document.getElementById('percentage');
    const progressBar = document.getElementById('progressBar');
    const downloadedSegmentsEl = document.getElementById('downloadedSegments');
    const totalSegmentsEl = document.getElementById('totalSegments');
    const cancelBtn = document.getElementById('cancelBtn');
    const backBtn = document.getElementById('backBtn');
    const errorSection = document.getElementById('errorSection');
    const errorMessage = document.getElementById('errorMessage');
    const mainContent = document.getElementById('mainContent');
    const doneSection = document.getElementById('doneSection');

    // Poll for status directly from checking storage
    // The background/content script will update this.
    function checkStatus() {

        chrome.storage.local.get(['hlsDownloadState'], (result) => {
            const state = result.hlsDownloadState;

            // If not downloading and not done recently, go back to popup
            // Allow 'complete' status to stay to show Done screen
            if (!state || (!state.isDownloading && state.status !== 'complete')) {
                // If we are showing done section, we might want to stay?
                // Actually if state is missing, we must go back.
                // If state is there but not downloading and not complete (e.g. error that cleared downloading flag?),
                // we might want to show error?
                // Let's rely on status.

                if (!doneSection.classList.contains('hidden')) {
                    // If we are already done, and state is gone or changed, maybe stay?
                    // But if state is gone, we usually want to cleanup.
                    // But let's stick to the logic: if status is complete, let it be handled by updateUI
                    return;
                }

                window.location.href = 'popup.html';
                return;
            }

            // Update UI
            updateUI(state);
        });
    }

    function updateUI(state) {
        if (state.url) urlEl.textContent = state.url;
        if (state.filename) filenameEl.textContent = state.filename;

        // Calculate progress
        const total = state.totalSegments || 0;
        const current = state.downloadedSegments || 0;
        let percent = 0;
        if (total > 0) {
            percent = Math.round((current / total) * 100);
        } else if (state.status === 'merging') {
            percent = 100;
        }

        // Update Text & Bars
        percentageEl.textContent = `${percent}%`;
        progressBar.style.width = `${percent}%`;
        downloadedSegmentsEl.textContent = `${current} segments`;
        totalSegmentsEl.textContent = total ? `${total} total` : 'Scanning...';

        // State Handling
        switch (state.status) {
            case 'downloading':
                statusBadge.textContent = 'Downloading';
                statusBadge.className = 'text-xs font-semibold inline-block py-1 px-2 uppercase rounded-full text-blue-600 bg-blue-200';
                cancelBtn.classList.remove('hidden');
                cancelBtn.textContent = 'Cancel';
                break;
            case 'merging':
                statusBadge.textContent = 'Merging';
                statusBadge.className = 'text-xs font-semibold inline-block py-1 px-2 uppercase rounded-full text-purple-600 bg-purple-200';
                progressBar.classList.add('bg-purple-500');
                progressBar.classList.remove('bg-blue-500');
                cancelBtn.textContent = 'Cancel (Merging...)';
                break;
            case 'complete':
                showDone();
                break;
            case 'error':
                statusBadge.textContent = 'Error';
                statusBadge.className = 'text-xs font-semibold inline-block py-1 px-2 uppercase rounded-full text-red-600 bg-red-200';
                progressBar.classList.add('bg-red-500');
                errorSection.classList.remove('hidden');
                errorMessage.textContent = state.error || 'Unknown error occurred';
                cancelBtn.textContent = 'Back';
                break;
        }
    }

    function showDone() {
        mainContent.classList.add('hidden');
        doneSection.classList.remove('hidden');
        clearInterval(pollInterval); // Stop polling when done
    }

    // Cancel Click
    cancelBtn.addEventListener('click', () => {
        clearInterval(pollInterval); // Stop polling immediately

        // Tell content script to cancel
        chrome.storage.local.get(['hlsDownloadState'], (result) => {
            const state = result.hlsDownloadState;
            if (state && state.tabId) {
                chrome.tabs.sendMessage(state.tabId, { action: 'cancelHLSDownload' }, () => {
                    // Clear state and redirect
                    chrome.storage.local.remove(['hlsDownloadState'], () => {
                        window.location.href = 'popup.html';
                    });
                });
            } else {
                // Fallback if no tabId found (e.g. old state), try broadcast but likely won't work for content script
                console.warn('No tabId found in state, falling back to runtime broadcast');
                chrome.runtime.sendMessage({ action: 'cancelHLSDownload' }, () => {
                    chrome.storage.local.remove(['hlsDownloadState'], () => {
                        window.location.href = 'popup.html';
                    });
                });
            }
        });
    });

    backBtn.addEventListener('click', () => {
        clearInterval(pollInterval);
        // Clean up state
        chrome.storage.local.remove(['hlsDownloadState'], () => {
            window.location.href = 'popup.html';
        });
    });

    // Initial check and interval
    checkStatus();
    const pollInterval = setInterval(checkStatus, 1000);
});
