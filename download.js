document.addEventListener('DOMContentLoaded', async () => {
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

    const logger = new ExtensionLogger('HLS Download');
    let pollInterval = null;

    // Poll for status directly from checking storage
    // The background/content script will update this.
    async function checkStatus() {
        try {
            const state = await DownloadState.loadFromStorage();

            /*
             * If not downloading and not done recently, go back to popup
             * Allow 'complete' status to stay to show Done screen
             */
            if (!state || state.isCancelled || state.isError) {
                if (!doneSection.classList.contains('hidden')) {
                    return;
                }

                window.location.href = 'popup.html';
                return;
            }

            // Update UI (use state object from DownloadState instance)
            updateUI(state);
        } catch (error) {
            logger.error('Failed to load download state:', error);
            window.location.href = 'popup.html';
        }
    }

    function updateUI(state) {
        if (state.url) urlEl.textContent = state.url;
        if (state.filename) filenameEl.textContent = state.filename;

        // Use progress from state
        const percent = state.status === 'merging' ? 100 : state.progress;

        // Update Text & Bars
        percentageEl.textContent = `${percent}%`;
        progressBar.style.width = `${percent}%`;
        const downloaded = state.downloadedSegments || 0;
        const total = state.totalSegments || 0;
        downloadedSegmentsEl.textContent = `${downloaded} segments`;
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
        // Stop polling when done
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
    }

    async function goBack() {
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
        // Clean up state
        try {
            await DownloadState.clear();
        } catch (e) {
            logger.warn('Error clearing state on back:', e);
        }
        window.location.href = 'popup.html';
    }

    // Cancel Click
    cancelBtn.addEventListener('click', async () => {
        // Stop polling immediately
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }

        // Tell content script to cancel
        try {
            const state = await DownloadState.loadFromStorage();
            if (state && state.tabId) {
                // ✅ Check if tab still exists first  
                if (!await isValidTab(state.tabId)) {
                    logger.warn('Tab no longer exists, cleaning up');
                    return;
                }

                // Tab exists, send cancel message
                await sendMessage(state.tabId, { action: REQUEST_ACTION_CANCEL_HLS_DOWNLOAD });
                // ✅ Ignore connection errors - tab might have reloaded/closed
                if (chrome.runtime.lastError) {
                    logger.warn('Could not send cancel message:', chrome.runtime.lastError.message);
                }
            } else {
                // No tabId - just clean up and go back
                logger.warn('No tabId found in state, falling back to runtime broadcast');
                await sendBroadcast({ action: REQUEST_ACTION_CANCEL_HLS_DOWNLOAD });
            }
        } catch (error) {
            logger.warn(error.message);
        } finally {
            await goBack();
        }
    });

    backBtn.addEventListener('click', async () => {
        await goBack();
    });

    // Initial check and interval
    await checkStatus();
    pollInterval = setInterval(() => checkStatus(), 1000);
});
