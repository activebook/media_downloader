// License management utilities

function generateUniqueKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let key = '';
  for (let i = 0; i < 16; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

async function verifyPass(key, pass) {
  try {
    const expectedPass = await generateComplexPass(key);
    return pass === expectedPass;
  } catch (error) {
    console.error('Pass verification error:', error);
    return false;
  }
}

async function generateComplexPass(key) {
  let data = new TextEncoder().encode(key + 'salt123');

  // Perform 1000 rounds of SHA-256 hashing for complexity
  for (let i = 0; i < 1000; i++) {
    data = await crypto.subtle.digest('SHA-256', data);
  }

  // Convert to hex string
  const hashArray = Array.from(new Uint8Array(data));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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
async function activateLicense(pass) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['licenseKey'], async (result) => {
      try {
        const isValid = await verifyPass(result.licenseKey, pass);
        if (isValid) {
          chrome.storage.local.set({ licenseActivated: true }, () => {
            resolve(true);
          });
        } else {
          resolve(false);
        }
      } catch (error) {
        console.error('License activation error:', error);
        resolve(false);
      }
    });
  });
}

// Get license key for display
function getLicenseKey(callback) {
  chrome.storage.local.get(['licenseKey'], (result) => {
    callback(result.licenseKey);
  });
}