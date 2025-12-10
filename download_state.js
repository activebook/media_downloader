// download_state.js - Download state management class
class DownloadState {
  static STORAGE_KEY = 'hlsDownloadState';

  constructor(url, filename, tabId) {
    if (!url || typeof url !== 'string') {
      throw new Error('DownloadState: url is required and must be a string');
    }
    if (!filename || typeof filename !== 'string') {
      throw new Error('DownloadState: filename is required and must be a string');
    }

    this.isDownloading = false;
    this.status = 'idle'; // 'idle', 'downloading', 'merging', 'complete', 'error'
    this.url = url;
    this.filename = filename;
    this.downloadedSegments = 0;
    this.totalSegments = 0;
    this.tabId = tabId;
    this.error = null;
    this.startTime = null;
    this.endTime = null;
  }

  // State transition methods
  async start() {
    this.isDownloading = true;
    this.status = 'downloading';
    this.startTime = Date.now();
    await this.persist();
  }

  async updateProgress(downloaded, total) {
    this.downloadedSegments = downloaded;
    this.totalSegments = total;
    await this.persist();
  }

  async startMerging() {
    this.status = 'merging';
    await this.persist();
  }

  async complete() {
    this.isDownloading = false;
    this.status = 'complete';
    this.endTime = Date.now();
    await this.persist();
  }

  async fail(error) {
    this.isDownloading = false;
    this.status = 'error';
    this.error = error;
    this.endTime = Date.now();
    await this.persist();
  }

  async cancel() {
    this.isDownloading = false;
    this.status = 'cancelled';
    this.endTime = Date.now();
    await this.persist();
  }

  // Computed properties
  get progress() {
    if (this.totalSegments === 0) return 0;
    return Math.round((this.downloadedSegments / this.totalSegments) * 100);
  }

  get duration() {
    if (!this.startTime || !this.endTime) return 0;
    return this.endTime - this.startTime;
  }

  get isActive() {
    return this.isDownloading && this.status !== 'error' && this.status !== 'cancelled';
  }

  get isDone() {
    return !this.isDownloading && this.status === 'complete';
  }

  get isError() {
    return !this.isDownloading && this.status === 'error';
  }

  get isCancelled() {
    return !this.isDownloading && this.status === 'cancelled';
  }

  // Persistence methods
  async persist() {
    try {
      await chrome.storage.local.set({ [DownloadState.STORAGE_KEY]: this.toJSON() });
    } catch (error) {
      throw new Error('DownloadState: Failed to persist state: ', error.message);
    }
  }

  static async clear() {
    try {
      await chrome.storage.local.remove([DownloadState.STORAGE_KEY]);
    } catch (error) {
      throw new Error('Failed to clear download state: ' + error.message);
    }
  }

  // Serialization
  toJSON() {
    return {
      isDownloading: this.isDownloading,
      status: this.status,
      url: this.url,
      filename: this.filename,
      downloadedSegments: this.downloadedSegments,
      totalSegments: this.totalSegments,
      tabId: this.tabId,
      error: this.error,
      startTime: this.startTime,
      endTime: this.endTime
    };
  }

  // Deserialization
  static fromJSON(data) {
    if (!data || !data.url || !data.filename) {
      throw new Error('Invalid DownloadState data for deserialization');
    }
    const state = new DownloadState(data.url, data.filename, data.tabId);
    Object.assign(state, data);
    return state;
  }

  // Static method to load from storage
  static async loadFromStorage() {
    try {
      const result = await chrome.storage.local.get([DownloadState.STORAGE_KEY]);
      if (result[DownloadState.STORAGE_KEY]) {
        return DownloadState.fromJSON(result[DownloadState.STORAGE_KEY]);
      }
    } catch (error) {
      throw new Error('Failed to load download state: ' + error.message);
    }
    return null;
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DownloadState;
}