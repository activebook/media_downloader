// Content script for downloading videos from page context
// This runs in the context of the web page and has access to the page's cookies

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'downloadVideoFromPage') {
        downloadVideoInPageContext(request.url, request.filename)
            .then(() => {
                sendResponse({ success: true });
            })
            .catch((error) => {
                sendResponse({ success: false, error: error.message });
            });
        return true; // Keep message channel open for async response
    }
});

async function downloadVideoInPageContext(url, filename) {
    try {
        // Create a temporary anchor element
        const link = document.createElement('a');
        link.href = url;
        link.download = filename || 'video.mp4';
        link.target = '_blank'; // Prevent replacing current page
        link.rel = 'noopener noreferrer'; // Security best practice
        link.style.display = 'none';

        // Add to page
        document.body.appendChild(link);

        // Trigger click to download
        link.click();

        // Clean up after a short delay
        setTimeout(() => {
            if (link.parentNode) {
                document.body.removeChild(link);
            }
        }, 100);

        return true;
    } catch (error) {
        console.error('Content script download failed:', error);
        throw error;
    }
}
