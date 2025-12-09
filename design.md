# Media Downloader Extension - Technical Design Report

## Introduction

The Media Downloader is a Chrome extension designed to detect and download video and audio media from web pages. It operates as a browser extension using Manifest V3, providing users with an easy way to capture media content from websites that might otherwise restrict downloads.

### Key Features
- **Automatic Media Detection**: Monitors network requests and DOM elements for media files
- **Multi-format Support**: Handles MP4, MP3, HLS streams (M3U8), and other common media formats
- **Tab-specific Operation**: Isolates media detection and downloads per browser tab
- **Real-time Progress Tracking**: Provides live updates during HLS downloads
- **License-based Activation**: Includes a licensing system for access control

### Technology Stack
- **Manifest Version**: V3 (Chrome Extension API)
- **JavaScript**: ES6+ with async/await
- **Storage**: Chrome Storage API for persistence
- **UI Framework**: Tailwind CSS for styling
- **Logging**: Custom ExtensionLogger class for debugging

## Architecture Overview

The extension follows a modular architecture with clear separation of concerns:

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Content Script│    │ Background      │    │   Popup UI      │
│   (Per Tab)     │◄──►│ Service Worker  │◄──►│   (Extension    │
│                 │    │                 │    │    Interface)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   DOM Scanning  │    │ Network Request │    │ Media List      │
│   & Downloads   │    │ Monitoring      │    │ Display         │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Component Responsibilities
- **Content Scripts**: Execute in webpage context, scan DOM, handle page-based downloads
- **Background Service Worker**: Monitors network requests, manages global state, coordinates operations
- **Popup Interface**: User-facing UI for media management and download initiation
- **Download Page**: Specialized UI for tracking HLS download progress

## Core Components

### 1. Background Service Worker (`background.js`)

**Role**: Central coordinator and network monitor

**Key Functions**:
- Monitors all network requests via `chrome.webRequest.onCompleted`
- Filters and categorizes media based on Content-Type and URL patterns
- Maintains global media store using Chrome Storage API
- Handles Bilibili-specific video URL resolution
- Manages tab lifecycle and cleanup

**Critical Logic**:
```javascript
chrome.webRequest.onCompleted.addListener((details) => {
  // Process only active tab requests
  if (details.tabId !== activeTabId) return;

  // Detect media by Content-Type headers
  const contentType = details.responseHeaders?.find(header =>
    header.name.toLowerCase() === 'content-type'
  )?.value;

  if (contentType && (contentType.startsWith('video/') || contentType.startsWith('audio/'))) {
    // Store media info with tab association
    const mediaInfo = {
      url: details.url,
      type: mediaType,
      size: size,
      timestamp: Date.now(),
      tabId: details.tabId
    };
  }
});
```

### 2. Content Scripts (`content.js` + `logger.js`)

**Role**: Page-context operations and DOM monitoring

**Key Functions**:
- Scans DOM for `<video>` and `<audio>` elements
- Sends detected media to background via messaging
- Handles downloads requiring page cookies/context
- Implements HLS stream downloading with segment merging
- Provides real-time download progress updates

**Injection Configuration** (from `manifest.json`):
```json
"content_scripts": [{
  "matches": ["<all_urls>"],
  "js": ["logger.js", "content.js"],
  "run_at": "document_idle",
  "all_frames": true
}]
```

**HLS Download Process**:
1. Parse M3U8 playlist for segment URLs
2. Download segments in batches (5 concurrent)
3. Merge segments into single Blob
4. Trigger download using DOM anchor element

### 3. Popup Interface (`popup.html` + `popup.js`)

**Role**: User interface for media management

**Key Functions**:
- Displays media list filtered by active tab
- Handles license activation workflow
- Initiates downloads via tab-specific messaging
- Provides refresh functionality to clear stale entries
- Redirects to download page for HLS progress tracking

**Tab-specific Filtering**:
```javascript
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const activeTabId = tabs[0]?.id;
  const currentTabMedia = mediaStore.filter(media => media.tabId === activeTabId);
});
```

### 4. Download Progress Page (`download.html` + `download.js`)

**Role**: Real-time HLS download monitoring

**Key Functions**:
- Polls `chrome.storage` for download state updates
- Displays progress bar and segment counts
- Handles cancellation requests
- Shows completion/error states

**State Management**:
```javascript
function checkStatus() {
  chrome.storage.local.get(['hlsDownloadState'], (result) => {
    const state = result.hlsDownloadState;
    if (state) updateUI(state);
  });
}
```

### 5. Utility Modules

**Logger (`logger.js`)**:
- Provides structured logging with context prefixes
- Debug mode toggle for development
- Multiple log levels (info, warn, error, success, progress)

**License System (`license.js`)**:
- Key generation and validation
- Activation state persistence
- API-based verification (simulated)

## Message Flow

### Primary Communication Patterns

1. **Content → Background**:
   ```javascript
   chrome.runtime.sendMessage({
     action: 'mediaDetected',
     mediaInfo: { url, type, size, timestamp, tabId }
   });
   ```

2. **Popup → Background**:
   ```javascript
   chrome.runtime.sendMessage({ action: 'refresh' });
   ```

3. **Popup → Content (Tab-specific)**:
   ```javascript
   chrome.tabs.sendMessage(tabId, {
     action: 'downloadHLS',
     url: mediaUrl,
     filename: 'video.ts',
     tabId: tabId
   });
   ```

   **Critical Design Choice**: Always targets the active tab to ensure:
   - DOM manipulation occurs in accessible page context
   - Authentication cookies are available for protected content
   - Download initiation aligns with user focus/intent
   - Prevents failures from suspended/unloaded tabs

4. **Content → Storage Updates**:
   ```javascript
   chrome.storage.local.set({ hlsDownloadState: state });
   ```

### Message Handling Architecture

- **Background**: `chrome.runtime.onMessage.addListener()` for global coordination
- **Content Scripts**: `chrome.runtime.onMessage.addListener()` for tab-specific commands
- **Popup/Download**: `chrome.storage.onChanged.addListener()` for reactive UI updates

## Media Detection Mechanisms

### 1. Network-based Detection
- **Trigger**: `chrome.webRequest.onCompleted`
- **Scope**: All HTTP responses from active tab
- **Filters**:
  - Content-Type headers (`video/*`, `audio/*`, `application/vnd.apple.mpegurl`)
  - URL patterns (`.m3u8`, `.mp4`, etc.)
  - Content-Disposition filename extensions
- **Exclusions**: Prevents self-detection of download segments

### 2. DOM-based Detection
- **Trigger**: Initial scan + MutationObserver for dynamic content
- **Targets**: `<video>` and `<audio>` elements
- **Fallback**: Periodic scanning (every 5 seconds)
- **Data Sources**: `src`, `currentSrc`, `<source>` children

### 3. Special Cases
- **Bilibili Integration**: API-based MP4 URL resolution for video pages
- **HLS Streams**: Detects `.m3u8` playlists and offers merged downloads
- **Blob URLs**: Reports but notes download limitations

## Download Strategies

### 1. Direct Downloads
- **Method**: `chrome.downloads.download()`
- **Use Case**: Audio files, simple video downloads
- **Advantages**: Native browser handling, resume support

### 2. Page Context Downloads
- **Method**: DOM anchor element with `click()`
- **Use Case**: Videos requiring authentication/cookies
- **Implementation**: Creates temporary `<a>` element in page DOM

**Tab-Specific Execution**: Downloads are always initiated in the active tab to ensure:
- DOM accessibility (non-active tabs may be suspended)
- Correct cookie/authentication context
- Reliable `click()` event execution
- User intent alignment (download from viewed tab)

### 3. HLS Stream Downloads
- **Method**: Fetch segments → Blob merging → DOM download
- **Process**:
  1. Parse M3U8 playlist
  2. Download segments concurrently (batches of 5)
  3. Combine into single `Blob` (MPEG-TS format)
  4. Generate `Blob` URL and trigger download
- **Progress Tracking**: Real-time segment count updates via storage

**Tab-Context Execution**: HLS downloads run in content scripts to leverage:
- DOM APIs for `Blob` URL creation (not available in service workers)
- Page authentication context for protected streams
- Proper cleanup of temporary DOM elements

## Security and Performance Considerations

### Security Measures
- **Content Security Policy**: Restricts script sources in extension pages
- **Host Permissions**: `<all_urls>` for broad access (necessary for media detection)
- **Message Validation**: Action-based routing prevents unauthorized commands
- **Tab Isolation**: Content scripts operate in separate contexts per tab

### Performance Optimizations
- **Debounced Scanning**: MutationObserver prevents excessive DOM checks
- **Batch Processing**: HLS downloads use concurrent but limited (5) segment fetches
- **Storage Cleanup**: Automatic removal of old entries (10-minute TTL)
- **Memory Management**: Blob URL revocation after downloads
- **Tab-Specific UI**: Popup only renders active tab media, reducing DOM complexity

### Privacy Considerations
- **Data Collection**: Only stores media URLs and metadata, no user content
- **Network Monitoring**: Limited to active tab requests
- **Storage Scope**: Local storage, not synced across devices

## Limitations and Future Improvements

### Current Limitations
1. **HLS Complexity**: Only supports basic M3U8 playlists (no adaptive bitrate switching)
2. **DRM Content**: Cannot download protected/encrypted media
3. **Blob URL Downloads**: Limited success with browser-generated media URLs
4. **Cross-origin Issues**: Some sites block extension access to media elements
5. **Memory Usage**: Large HLS downloads consume significant RAM during merging

### Potential Enhancements
1. **Advanced HLS Support**:
   - Adaptive bitrate selection
   - Encrypted stream handling
   - DASH protocol support

2. **Download Management**:
   - Queue system for multiple downloads
   - Pause/resume functionality
   - Download history and favorites

3. **Media Processing**:
   - Format conversion (TS → MP4)
   - Quality selection
   - Batch processing tools

4. **User Experience**:
   - Keyboard shortcuts
   - Context menu integration
   - Custom filename templates

5. **Developer Tools**:
   - Debug logging toggle
   - Performance monitoring
   - Extension update notifications

### Technical Debt
- **Code Organization**: Some functions could be modularized further
- **Error Handling**: Inconsistent error propagation across components
- **Testing**: Limited automated test coverage
- **Documentation**: API documentation could be more comprehensive

## Conclusion

The Media Downloader extension demonstrates a well-architected approach to browser extension development, effectively balancing functionality, performance, and security. The modular design with clear separation between background monitoring, content script operations, and user interface components provides a solid foundation for future enhancements.

The use of Chrome's Manifest V3 APIs ensures compatibility with modern browser standards, while the tab-specific architecture maintains isolation and prevents cross-site interference. The combination of network monitoring and DOM scanning provides comprehensive media detection capabilities.

**Key Architectural Insight**: The tab-specific design is particularly clever - downloads always execute in the active tab context, ensuring DOM accessibility, proper authentication, and user intent alignment. This prevents common extension pitfalls like attempting DOM manipulation in suspended tabs or losing authentication context.

Future development should focus on expanding format support, improving HLS handling, and adding user experience enhancements while maintaining the current security and performance standards.