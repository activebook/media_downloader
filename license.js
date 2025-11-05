// License management utilities

function generateUniqueKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let key = '';
  for (let i = 0; i < 16; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

function verifyPass(key, pass) {
  // Simple verification: pass should be SHA-256 hash of key + salt
  const expectedPass = sha256(key + 'salt123');
  return pass === expectedPass;
}

function sha256(message) {
  // Simple hash function for demo (in production, use crypto.subtle)
  let hash = 0;
  for (let i = 0; i < message.length; i++) {
    const char = message.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}

// Initialize license on installation
function initLicense() {
  chrome.storage.local.get(['licenseKey'], (result) => {
    if (!result.licenseKey) {
      const key = generateUniqueKey();
      chrome.storage.local.set({ licenseKey: key, licenseActivated: false });
      console.log('Generated license key:', key);
    }
  });
}

// Check if license is activated
function isLicenseActivated(callback) {
  chrome.storage.local.get(['licenseActivated'], (result) => {
    callback(result.licenseActivated || false);
  });
}

// Activate license with pass
function activateLicense(pass, callback) {
  chrome.storage.local.get(['licenseKey'], (result) => {
    if (verifyPass(result.licenseKey, pass)) {
      chrome.storage.local.set({ licenseActivated: true }, () => {
        callback(true);
      });
    } else {
      callback(false);
    }
  });
}

// Get license key for display
function getLicenseKey(callback) {
  chrome.storage.local.get(['licenseKey'], (result) => {
    callback(result.licenseKey);
  });
}