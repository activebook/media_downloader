// media_detector.js - Robust media detection utility for Chrome extensions

class MediaDetector {
  // Configuration constants
  static MEDIA_CONTENT_TYPES = {
    VIDEO: [
      'video/mp4',
      'video/webm',
      'video/ogg',
      'video/quicktime',
      'video/x-msvideo',
      'video/x-matroska',
      'video/x-flv',
      'video/3gpp',
      'video/mp2t',
      'application/vnd.apple.mpegurl',  // HLS
      'application/x-mpegurl',   // HLS alternative
      'application/dash+xml',  // DASH
    ],
    AUDIO: [
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/wave',
      'audio/x-wav',
      'audio/ogg',
      'audio/webm',
      'audio/flac',
      'audio/aac',
      'audio/x-m4a',
      'audio/mp4',
    ],
    AMBIGUOUS: [
      'application/octet-stream',  // Generic binary - needs URL check
    ]
  };

  static MEDIA_EXTENSIONS = {
    VIDEO: ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'm3u8', 'mpd', 'ts'],
    AUDIO: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus'],
  };

  // Patterns to exclude (segments, thumbnails, etc.)
  static EXCLUSION_PATTERNS = [
    /\.ts(\?|$)/i,  // TS segments
    /\/segment[_-]?\d+/i,   // Segment files
    /thumbnail/i,   // Thumbnails
    /preview/i,   // Preview images
    /ads?\//i,    // Ad content
  ];

  /**
   * Check if a URL should be excluded from detection
   */
  static shouldExclude(url) {
    return this.EXCLUSION_PATTERNS.some(pattern => pattern.test(url));
  }

  /**
   * Extract extension from URL
   */
  static extractExtension(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const match = pathname.match(/\.([a-z0-9]+)$/i);
      return match ? match[1].toLowerCase() : null;
    } catch {
      return null;
    }
  }

  /**
   * Extract filename from Content-Disposition header
   */
  static extractFilenameFromDisposition(disposition) {
    if (!disposition) return null;

    // Try RFC 6266 filename*= format first
    const encodedMatch = disposition.match(/filename\*=(?:UTF-8''|[^']*'[^']*')([^;]+)/i);
    if (encodedMatch) {
      try {
        return decodeURIComponent(encodedMatch[1]);
      } catch {
        // Fall through to regular filename
      }
    }

    // Try regular filename= format
    const regularMatch = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/i);
    if (regularMatch) {
      return regularMatch[1].replace(/['"]/g, '').trim();
    }

    return null;
  }

  /**
   * Determine media type from content-type string
   */
  static getMediaTypeFromContentType(contentType) {
    if (!contentType) return null;

    // Normalize content-type (remove charset, etc.)
    const normalized = contentType.split(';')[0].trim().toLowerCase();

    if (this.MEDIA_CONTENT_TYPES.VIDEO.includes(normalized)) {
      return 'video';
    }
    if (this.MEDIA_CONTENT_TYPES.AUDIO.includes(normalized)) {
      return 'audio';
    }
    if (this.MEDIA_CONTENT_TYPES.AMBIGUOUS.includes(normalized)) {
      return 'ambiguous';
    }

    return null;
  }

  /**
   * Determine media type from file extension
   */
  static getMediaTypeFromExtension(extension) {
    if (!extension) return null;

    const ext = extension.toLowerCase();

    if (this.MEDIA_EXTENSIONS.VIDEO.includes(ext)) {
      return 'video';
    }
    if (this.MEDIA_EXTENSIONS.AUDIO.includes(ext)) {
      return 'audio';
    }

    return null;
  }

  /**
   * Extract header value from response headers array
   */
  static getHeader(headers, headerName) {
    if (!headers || !Array.isArray(headers)) return null;

    const header = headers.find(h =>
      h.name.toLowerCase() === headerName.toLowerCase()
    );

    return header?.value || null;
  }

  /**
   * Main detection method - analyzes web request details
   * @param {Object} details - Chrome webRequest details object
   * @returns {Object|null} Detection result or null if not media
   */
  static detect(details) {
    // Basic validation
    if (!details?.url || !details.url.startsWith('http')) {
      return null;
    }

    // Check exclusion patterns
    if (this.shouldExclude(details.url)) {
      return null;
    }

    const contentType = this.getHeader(details.responseHeaders, 'content-type');
    const contentLength = this.getHeader(details.responseHeaders, 'content-length');
    const contentDisposition = this.getHeader(details.responseHeaders, 'content-disposition');

    let mediaType = null;
    let detectionMethod = null;

    // Method 1: Detect by Content-Type header
    const typeFromContentType = this.getMediaTypeFromContentType(contentType);
    if (typeFromContentType && typeFromContentType !== 'ambiguous') {
      mediaType = typeFromContentType;
      detectionMethod = 'content-type';
    }

    // Method 2: Detect by URL extension (high confidence)
    if (!mediaType) {
      const extension = this.extractExtension(details.url);
      const typeFromExtension = this.getMediaTypeFromExtension(extension);

      if (typeFromExtension) {
        mediaType = typeFromExtension;
        detectionMethod = 'url-extension';
      }
    }

    // Method 3: Detect by Content-Disposition filename
    if (!mediaType && contentDisposition) {
      const filename = this.extractFilenameFromDisposition(contentDisposition);
      if (filename) {
        const extension = filename.split('.').pop()?.toLowerCase();
        const typeFromFilename = this.getMediaTypeFromExtension(extension);

        if (typeFromFilename) {
          mediaType = typeFromFilename;
          detectionMethod = 'content-disposition';
        }
      }
    }

    // Method 4: Handle ambiguous Content-Type with URL check
    if (!mediaType && typeFromContentType === 'ambiguous') {
      const extension = this.extractExtension(details.url);
      const typeFromExtension = this.getMediaTypeFromExtension(extension);

      if (typeFromExtension) {
        mediaType = typeFromExtension;
        detectionMethod = 'ambiguous-resolved';
      }
    }

    // No media detected
    if (!mediaType) {
      return null;
    }

    // Return detection result
    return {
      url: details.url,
      type: mediaType,
      contentType: contentType || 'unknown',
      size: contentLength ? parseInt(contentLength, 10) : null,
      tabId: details.tabId,
      timestamp: Date.now(),
      detectionMethod,
    };
  }

  /**
   * Batch detection with filtering
   * @param {Array} detailsArray - Array of webRequest details
   * @returns {Array} Array of detection results
   */
  static detectBatch(detailsArray) {
    return detailsArray
      .map(details => this.detect(details))
      .filter(result => result !== null);
  }

  /**
   * Check if a URL looks like a streaming manifest
   */
  static isStreamingManifest(url) {
    const extension = this.extractExtension(url);
    return ['m3u8', 'mpd'].includes(extension?.toLowerCase());
  }

  /**
   * Check if content type indicates streaming
   */
  static isStreamingContentType(contentType) {
    if (!contentType) return false;

    const normalized = contentType.split(';')[0].trim().toLowerCase();
    return [
      'application/vnd.apple.mpegurl',
      'application/x-mpegurl',
      'application/dash+xml',
    ].includes(normalized);
  }

  /**
   * Extract bilibili video URL (synchronous part)
   * @param {string} url - The current page URL
   * @returns {Object|null} Extraction result with bvCode if valid bilibili video page
   */
  static extractBilibiliVideoPage(url) {
    try {
      // Check if URL is from bilibili.com and matches video pattern
      const urlObj = new URL(url);
      if (!urlObj.hostname.includes('bilibili.com') || !url.includes('/video/')) {
        return null;
      }

      // Extract BV code using regex
      const bvMatch = url.match(/\/video\/(BV[0-9A-Za-z]+)/);
      if (!bvMatch) {
        return null;
      }

      return {
        bvCode: bvMatch[1],
        apiBvCode: bvMatch[1].substring(2) // Remove 'BV' prefix
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Fetch bilibili video MP4 URL from external API (async part)
   * @param {string} apiBvCode - BV code without 'BV' prefix
   * @returns {string|null} MP4 URL or null if failed
   */
  static async fetchBilibiliVideoUrl(apiBvCode) {
    try {
      // Call the external API to get MP4 URL
      const apiUrl = `https://api.injahow.cn/bparse/?bv=${apiBvCode}&otype=url`;
      const response = await fetch(apiUrl);

      if (!response.ok) {
        return null;
      }

      const mp4Url = await response.text();

      // Validate that we got a valid URL
      if (!mp4Url || !mp4Url.startsWith('http')) {
        return null;
      }

      return mp4Url;
    } catch (error) {
      return null;
    }
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MediaDetector;
}

// Usage example:
//
// chrome.webRequest.onCompleted.addListener(
//   (details) => {
//   if (details.tabId !== activeTabId) return;
//  
//   const detection = MediaDetector.detect(details);
//   if (detection) {
//   const mediaInfo = MediaInfo.create({
//   url: detection.url,
//   type: detection.type,
//   size: detection.size,
//   tabId: detection.tabId,
//   timestamp: detection.timestamp,
//   source: detection.detectionMethod
//   });
//  
//   mediaStore.addMedia(mediaInfo);
//   }
//   },
//   { urls: ['<all_urls>'] },
//   ['responseHeaders']
// );
