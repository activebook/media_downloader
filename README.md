# Media Downloader Chrome Extension

A Chrome extension that automatically detects video and audio media on web pages and provides an easy way to download them.

## Features

- **Automatic Detection**: Monitors network requests to detect video and audio files as they load
- **Real-time Updates**: Media list updates in real-time as new content loads
- **Per-Tab Tracking**: Shows media only from the currently active tab
- **Download Management**: Direct download buttons for each detected media file
- **Refresh Functionality**: Manual refresh to clear and re-scan for media
- **Size Information**: Displays file sizes when available
- **Clean UI**: Simple popup interface with organized media list

## Installation

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory
5. The extension should now be installed and visible in your toolbar

## Usage

1. Navigate to any website with video or audio content
2. Click the Media Downloader extension icon in your toolbar
3. The popup will show detected media files from the current tab
4. Click "Download" next to any media file to save it
5. Use "Refresh" to clear the list and re-scan for new media

## How It Works

- **Background Script**: Monitors all network requests using `chrome.webRequest` API
- **Content Detection**: Identifies video/* and audio/* content types
- **Storage**: Saves media information in `chrome.storage` for persistence
- **Popup Interface**: Displays media list with download functionality
- **Real-time Updates**: Listens for storage changes to update the UI automatically

## Limitations

- Only detects media that has been requested by the browser
- Lazy-loaded media may not appear until triggered
- File size information depends on server headers
- Downloads are handled by Chrome's built-in download manager

## Browser Compatibility

- Chrome 88+ (Manifest V3)
- Chromium-based browsers (Edge, Opera, etc.)

## License

This project is open source and available under the MIT License.
