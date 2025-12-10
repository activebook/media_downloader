// media_store.js - Centralized media storage management
class MediaStore {
  constructor() {
    this.store = new Map();
    this.maxAge = 10 * 60 * 1000; // 10 minutes
    this.cleanupInterval = null;
    this.startCleanupTimer();
  }

  // Add media with validation
  addMedia(mediaInfo) {
    if (!(mediaInfo instanceof MediaInfo)) {
      throw new Error('MediaStore: mediaInfo must be an instance of MediaInfo');
    }

    // Avoid duplicates by URL
    if (!this.store.has(mediaInfo.url)) {
      this.store.set(mediaInfo.url, mediaInfo);
      this.persist();
    }
  }

  // Get all media for a specific tab
  getMediaForTab(tabId) {
    if (!tabId) return [];

    return Array.from(this.store.values())
      .filter(media => media.tabId === tabId)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  // Get filtered media for a tab with showBlob and showSegment filter parameters
  getMediaForTabFilter(tabId, showBlob = false, showSegment = false) {
    if (!tabId) return [];

    // Helper functions for cleaner filtering logic
    const isBlobMedia = (media) => {
      return media.source === 'blob' || (media.url && media.url.startsWith('blob:'));
    };

    const isSegmentMedia = (media) => {
      const url = media.url?.toLowerCase() || '';

      // Check MIME types for segments
      if (media.type) {
        const mimeType = media.type.toLowerCase();
        if (mimeType.includes('mp2t') || mimeType.includes('iso')) {
          return true;
        }
      }

      // Check file extensions and patterns
      return url.includes('.ts') || url.includes('.m4s') ||
             url.includes('segment') || /\/segment\/\d+/.test(url);
    };

    return Array.from(this.store.values())
      .filter(media => media.tabId === tabId)
      .filter(media => {
        // Apply filters based on settings
        if (!showBlob && isBlobMedia(media)) return false;
        if (!showSegment && isSegmentMedia(media)) return false;
        return true;
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  // Get all media (for debugging/admin purposes)
  getAllMedia() {
    return Array.from(this.store.values())
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  // Remove media older than maxAge
  removeOldEntries() {
    let removedCount = 0;

    for (const [url, media] of this.store.entries()) {
      if (media.isExpired(this.maxAge)) {
        this.store.delete(url);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      this.persist();
    }

    return removedCount;
  }

  // Clear media for a specific tab or old entries
  clearForTab(tabId, maxAge = 5 * 60 * 1000) { // 5 minutes default
    let removedCount = 0;

    for (const [url, media] of this.store.entries()) {
      if (media.tabId === tabId && media.isExpired(maxAge)) {
        this.store.delete(url);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      this.persist();
    }

    return removedCount;
  }

  // Clear all media
  clearAll() {
    this.store.clear();
    this.persist();
  }

  // Get media count
  get size() {
    return this.store.size;
  }

  // Check if URL exists
  hasMedia(url) {
    return this.store.has(url);
  }

  // Get specific media by URL
  getMedia(url) {
    return this.store.get(url) || null;
  }

  // Remove specific media
  removeMedia(url) {
    const removed = this.store.delete(url);
    if (removed) {
      this.persist();
    }
    return removed;
  }

  // Persistence methods
  async persist() {
    try {
      const data = Array.from(this.store.entries());
      await chrome.storage.local.set({ mediaStore: data });
    } catch (error) {
      console.error('MediaStore: Failed to persist to storage:', error);
    }
  }

  async loadFromStorage() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const result = await chrome.storage.local.get(['mediaStore']);
        if (result.mediaStore && Array.isArray(result.mediaStore)) {
          this.store = new Map(result.mediaStore.map(([url, data]) => [url, MediaInfo.fromJSON(data)]));
        }
      }
    } catch (error) {
      console.error('MediaStore: Failed to load from storage:', error);
    }
  }

  // Cleanup timer management
  startCleanupTimer() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    // Run cleanup every minute
    this.cleanupInterval = setInterval(() => {
      this.removeOldEntries();
    }, 60 * 1000);
  }

  stopCleanupTimer() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  // Export for debugging
  toJSON() {
    return {
      size: this.store.size,
      maxAge: this.maxAge,
      media: Array.from(this.store.values()).map(media => media.toJSON())
    };
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MediaStore;
}
