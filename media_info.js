// media_info.js - Media information class with factory pattern
class MediaInfo {
  // Valid media types
  static VALID_TYPES = ['video', 'audio'];

  // Private constructor - use factory methods instead
  constructor(url, type, size, tabId, timestamp, source) {
    // Validation
    if (!url || typeof url !== 'string') {
      throw new Error('MediaInfo: url is required and must be a string');
    }
    if (!type || typeof type !== 'string') {
      throw new Error('MediaInfo: type is required and must be a string');
    }
    if (!MediaInfo.VALID_TYPES.includes(type)) {
      throw new Error(`MediaInfo: type must be one of: ${MediaInfo.VALID_TYPES.join(', ')}`);
    }
    if (size !== null && (typeof size !== 'number' || size < 0)) {
      throw new Error('MediaInfo: size must be null or a non-negative number');
    }
    if (tabId !== null && typeof tabId !== 'number') {
      throw new Error('MediaInfo: tabId must be null or a number');
    }
    if (typeof timestamp !== 'number' || timestamp < 0) {
      throw new Error('MediaInfo: timestamp must be a non-negative number');
    }
    if (source !== null && typeof source !== 'string') {
      throw new Error('MediaInfo: source must be null or a string');
    }

    // Use Object.defineProperties for immutability
    Object.defineProperties(this, {
      url: { value: url, enumerable: true },
      type: { value: type, enumerable: true },
      size: { value: size, enumerable: true, writable: true }, // Make size mutable
      tabId: { value: tabId, enumerable: true },
      timestamp: { value: timestamp, enumerable: true },
      source: { value: source, enumerable: true }
    });

    // Cannot modify media after creation.
    // Prevent add/remove properties dynamically
    Object.seal(this);
  }

  // Factory method: Create from object with named parameters
  static create({ url, type, size = null, tabId = null, timestamp = Date.now(), source = null }) {
    return new MediaInfo(url, type, size, tabId, timestamp, source);
  }

  // Factory method: Create from positional parameters (for backward compatibility)
  static from(url, type, size = null, tabId = null, timestamp = Date.now(), source = null) {
    return new MediaInfo(url, type, size, tabId, timestamp, source);
  }

  // Factory method: Deserialize from JSON
  static fromJSON(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('MediaInfo.fromJSON: data must be an object');
    }

    return new MediaInfo(
      data.url,
      data.type,
      data.size ?? null,
      data.tabId ?? null,
      data.timestamp ?? Date.now(),
      data.source ?? null
    );
  }

  // Factory method: Create video media
  static video({ url, size = null, tabId = null, timestamp = Date.now(), source = null }) {
    return new MediaInfo(url, 'video', size, tabId, timestamp, source);
  }

  // Factory method: Create audio media
  static audio({ url, size = null, tabId = null, timestamp = Date.now(), source = null }) {
    return new MediaInfo(url, 'audio', size, tabId, timestamp, source);
  }

  // Serialize to JSON for storage
  toJSON() {
    return {
      url: this.url,
      type: this.type,
      size: this.size,
      tabId: this.tabId,
      timestamp: this.timestamp,
      source: this.source
    };
  }

  // Get human-readable size string
  static getFormattedSize(media) {
    if (media.size === null || media.size === undefined) {
      return 'Unknown';
    }

    let size = media.size;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  // Check if media is expired based on maxAge (in milliseconds)
  isExpired(maxAge) {
    if (typeof maxAge !== 'number' || maxAge < 0) {
      throw new Error('MediaInfo.isExpired: maxAge must be a non-negative number');
    }
    return (Date.now() - this.timestamp) > maxAge;
  }

  // Get age in milliseconds
  getAge() {
    return Date.now() - this.timestamp;
  }

  // Create a copy with updated properties
  with(updates) {
    if (!updates || typeof updates !== 'object') {
      throw new Error('MediaInfo.with: updates must be an object');
    }

    return new MediaInfo(
      updates.url ?? this.url,
      updates.type ?? this.type,
      updates.size ?? this.size,
      updates.tabId ?? this.tabId,
      updates.timestamp ?? this.timestamp,
      updates.source ?? this.source
    );
  }

  // String representation for debugging
  toString() {
    return `MediaInfo(${this.type}: ${this.url}, size: ${MediaInfo.getFormattedSize(this)}, source: ${this.source ?? 'unknown'})`;
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MediaInfo;
}

// Usage examples:
// 
// const media1 = MediaInfo.create({
//   url: 'https://example.com/video.mp4',
//   type: 'video',
//   size: 1024000,
//   source: 'bilibili'
// });
//
// const media2 = MediaInfo.video({
//   url: 'https://example.com/video.mp4',
//   size: 1024000,
//   source: 'bilibili'
// });
//
// const media3 = MediaInfo.audio({
//   url: 'https://example.com/audio.mp3',
//   size: 512000
// });
//
// const media4 = MediaInfo.from(
//   'https://example.com/video.mp4',
//   'video',
//   1024000
// );
//
// const media5 = MediaInfo.fromJSON({
//   url: 'https://example.com/video.mp4',
//   type: 'video',
//   size: 1024000
// });
