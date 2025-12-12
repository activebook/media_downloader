document.addEventListener('DOMContentLoaded', () => {
    const showBlobCheckbox = document.getElementById('showBlob');
    const showSegmentCheckbox = document.getElementById('showSegment');
    const fetchBatchSizeInput = document.getElementById('fetchBatchSize');
    const registerKeyDiv = document.getElementById('registerKey');
    const licenseKeyDiv = document.getElementById('licenseKey');
    const statusDiv = document.getElementById('status');

    // Load settings
    chrome.storage.local.get(['showBlob', 'showSegment', 'fetchBatchSize', 'licenseKey', 'storedPass'], (result) => {
        // Settings defaults are false
        showBlobCheckbox.checked = result.showBlob || false;
        showSegmentCheckbox.checked = result.showSegment || false;
        fetchBatchSizeInput.value = result.fetchBatchSize || 5;

        // License Info
        registerKeyDiv.textContent = result.licenseKey || 'Not generated yet';
        licenseKeyDiv.textContent = result.storedPass || 'Not activated';
    });

    // Save settings on change
    function saveSetting(key, value) {
        chrome.storage.local.set({ [key]: value }, () => {
            showStatus('Settings Saved');
        });
    }

    showBlobCheckbox.addEventListener('change', (e) => {
        saveSetting('showBlob', e.target.checked);
    });

    showSegmentCheckbox.addEventListener('change', (e) => {
        saveSetting('showSegment', e.target.checked);
    });

    fetchBatchSizeInput.addEventListener('change', (e) => {
        const value = parseInt(e.target.value);
        if (value >= 1 && value <= 20) {
            saveSetting('fetchBatchSize', value);
        } else {
            e.target.value = 5; // reset to default
        }
    });

    function showStatus(message) {
        statusDiv.textContent = message;
        statusDiv.style.opacity = '1';
        setTimeout(() => {
            statusDiv.style.opacity = '0';
        }, 2000);
    }
});
