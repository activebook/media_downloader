document.addEventListener('DOMContentLoaded', () => {
    const showBlobCheckbox = document.getElementById('showBlob');
    const showTsCheckbox = document.getElementById('showTs');
    const registerKeyDiv = document.getElementById('registerKey');
    const licenseKeyDiv = document.getElementById('licenseKey');
    const statusDiv = document.getElementById('status');

    // Load settings
    chrome.storage.local.get(['showBlob', 'showTs', 'licenseKey', 'storedPass'], (result) => {
        // Settings defaults are false
        showBlobCheckbox.checked = result.showBlob || false;
        showTsCheckbox.checked = result.showTs || false;

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

    showTsCheckbox.addEventListener('change', (e) => {
        saveSetting('showTs', e.target.checked);
    });

    function showStatus(message) {
        statusDiv.textContent = message;
        statusDiv.style.opacity = '1';
        setTimeout(() => {
            statusDiv.style.opacity = '0';
        }, 2000);
    }
});
