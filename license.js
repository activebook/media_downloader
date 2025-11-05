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
    // Pass format: encrypted_salt(8 chars) + verification_hash(16 chars) = 24 chars total
    if (pass.length !== 24) return false;

    const encryptedSaltHex = pass.substring(0, 8);
    const verificationHash = pass.substring(8);

    // Decrypt the salt using the key
    const salt = await decryptSalt(key, encryptedSaltHex);

    // Verify the hash
    const expectedHash = await generateVeryShortHash(key + salt);
    return verificationHash === expectedHash;
  } catch (error) {
    console.error('Pass verification error:', error);
    return false;
  }
}

async function decryptSalt(key, encryptedSaltHex) {
  try {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)),
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    // Convert hex back to bytes (first 32 chars = 16 bytes for IV + some encrypted data)
    const encryptedBytes = new Uint8Array(encryptedSaltHex.match(/.{2}/g).map(h => parseInt(h, 16)));
    const iv = encryptedBytes.slice(0, 12);
    const encrypted = encryptedBytes.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      keyMaterial,
      encrypted
    );

    return new TextDecoder().decode(decrypted);
  } catch (error) {
    throw new Error('Failed to decrypt salt');
  }
}

async function generateVeryShortHash(message) {
  let data = new TextEncoder().encode(message);

  // Perform 200 rounds of SHA-256 hashing
  for (let i = 0; i < 200; i++) {
    data = await crypto.subtle.digest('SHA-256', data);
  }

  const hashArray = Array.from(new Uint8Array(data));
  // Take first 8 bytes (16 hex chars) for very short hash
  return hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
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
function isLicenseActivated(skip=false, callback) {
  if (skip) {
    callback(true);
    return;
  }
  chrome.storage.local.get(['licenseActivated', 'verificationToken', 'licenseKey'], (result) => {
    if (result.licenseActivated && result.verificationToken && result.licenseKey) {
      // Verify the token is valid for this installation
      chrome.storage.local.get(['storedPass'], (passResult) => {
        if (passResult.storedPass) {
          createVerificationToken(result.licenseKey, passResult.storedPass).then(expectedToken => {
            if (result.verificationToken === expectedToken) {
              callback(true);
            } else {
              // Token mismatch - possible tampering, reset activation
              resetActivation();
              callback(false);
            }
          });
        } else {
          callback(false);
        }
      });
    } else {
      callback(false);
    }
  });
}

function resetActivation() {
  chrome.storage.local.set({
    licenseActivated: false,
    verificationToken: null,
    storedPass: null
  });
}

// Activate license with pass
async function activateLicense(pass) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['licenseKey'], async (result) => {
      try {
        const isValid = await verifyPass(result.licenseKey, pass);
        if (isValid) {
          // Create verification token tied to this specific key
          const verificationToken = await createVerificationToken(result.licenseKey, pass);
          chrome.storage.local.set({
            licenseActivated: true,
            verificationToken: verificationToken,
            storedPass: pass  // Store the validated pass
          }, () => {
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

async function createVerificationToken(key, pass) {
  // Fast hash of key + pass for verification
  const data = new TextEncoder().encode(key + pass + 'verify_salt');
  const hash = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hash));
  return hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Get license key for display
function getLicenseKey(callback) {
  chrome.storage.local.get(['licenseKey'], (result) => {
    callback(result.licenseKey);
  });
}