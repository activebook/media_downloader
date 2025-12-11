// bili.js - Bilibili video handling and URL deduplication
// Note: MediaDetector, MediaInfo, MediaStore, and logger are already imported in background.js

class BiliHandler {
  constructor() {
    // Map to store bili URLs: key is the main path without parameters, value is the full URL
    this.biliUrlStore = new Map();
  }

  /**
   * Extract the main path from a URL (without query parameters)
   * @param {string} url - The full URL
   * @returns {string|null} The main path or null if invalid
   */
  extractMainPath(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.origin + urlObj.pathname;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if a bili URL is already stored (by main path)
   * @param {string} url - The URL to check
   * @returns {boolean} True if already stored
   */
  isUrlStored(url) {
    const mainPath = this.extractMainPath(url);
    return mainPath && this.biliUrlStore.has(mainPath);
  }

  /**
   * Add a bili URL to the store
   * @param {string} url - The full URL to store
   */
  addUrlToStore(url) {
    const mainPath = this.extractMainPath(url);
    if (mainPath && !this.biliUrlStore.has(mainPath)) {
      this.biliUrlStore.set(mainPath, url);
    }
  }

  /**
   * Handle bilibili video page detection and API calls
   * @param {string} url - The page URL
   * @param {number} tabId - The tab ID
   * @param {MediaStore} mediaStore - The media store instance
   * @param {ExtensionLogger} logger - The logger instance
   */
  async handleBilibiliVideo(url, tabId, mediaStore, logger) {
    // Check if this is a bilibili video page
    const videoPage = MediaDetector.extractBilibiliVideoPage(url);
    if (!videoPage) {
      return;
    }

    try {
      // Fetch the MP4 URL from the API
      const mp4Url = await MediaDetector.fetchBilibiliVideoUrl(videoPage.apiBvCode);

      if (!mp4Url) {
        logger.warn('Failed to fetch bilibili video URL for BV:', videoPage.bvCode);
        return;
      }

      // Check if this URL is already stored (prevent duplicates)
      if (this.isUrlStored(mp4Url)) {
        logger.info('Bilibili video URL already stored, skipping:', mp4Url);
        return;
      }

      // Add to bili URL store
      this.addUrlToStore(mp4Url);

      // Create media info for the MP4 URL
      const mediaInfo = MediaInfo.create({
        url: mp4Url,
        type: 'video',
        size: null, // API doesn't provide size
        tabId: tabId,
        timestamp: Date.now(),
        source: 'bilibili original' // Mark as coming from bilibili original video
      });

      // Add to media store (this will also handle any remaining duplicates by URL)
      mediaStore.addMedia(mediaInfo);
      logger.info('Added bilibili video to media store:', mp4Url);
    } catch (error) {
      logger.warn('Error fetching bilibili video URL:', error);
    }
  }

  /**
   * Get all stored bili URLs
   * @returns {Array} Array of stored URLs
   */
  getStoredUrls() {
    return Array.from(this.biliUrlStore.values());
  }

  /**
   * Clear all stored bili URLs
   */
  clearStoredUrls() {
    this.biliUrlStore.clear();
  }

  /**
   * Get the count of stored URLs
   * @returns {number} Number of stored URLs
   */
  getStoredCount() {
    return this.biliUrlStore.size;
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BiliHandler;
}
