// Background script for Streamer Mode for ChatGPT
// Handles screen sharing detection and communication between popup and content scripts

// Initialize default settings
chrome.runtime.onInstalled.addListener(function() {
  chrome.storage.sync.set({
    streamerMode: false,
    autoDetect: false,
    hideCompletely: false
  });
});

// Track screen sharing state
let isScreenSharing = false;

// Function to detect screen sharing
async function detectScreenSharing() {
  try {
    // Check if auto-detect is enabled
    const settings = await chrome.storage.sync.get(['autoDetect']);
    if (!settings.autoDetect) return;
    
    // Use getDisplayMedia to detect screen sharing
    // This is a workaround as extensions can't directly detect system screen sharing
    // We'll use a permission-based approach to check if screen sharing might be active
    
    // Check if any tab has getDisplayMedia permissions
    chrome.tabs.query({}, function(tabs) {
      // We can't directly detect screen sharing, but we can monitor for potential indicators
      // For now, we'll use a message passing approach where the content script can notify
      // the background script when it detects potential screen sharing
      
      // In a real implementation, we would need to use more sophisticated methods
      // or rely on browser APIs that might become available in the future
    });
  } catch (error) {
    console.error('Error detecting screen sharing:', error);
  }
}

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  // Handle streamer mode toggle
  if (request.action === 'updateStreamerMode') {
    // Forward the message to all ChatGPT tabs
    chrome.tabs.query({url: 'https://chatgpt.com/*'}, function(tabs) {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          action: 'toggleStreamerMode',
          enabled: request.enabled,
          hideCompletely: request.hideCompletely || false
        });
      });
    });
  }
  
  // Handle auto-detect toggle
  if (request.action === 'updateAutoDetect') {
    // If auto-detect is enabled, start monitoring for screen sharing
    if (request.enabled) {
      detectScreenSharing();
    }
  }
  
  // Handle screen sharing detection from content script
  if (request.action === 'screenSharingDetected') {
    isScreenSharing = request.isSharing;
    
    // If auto-detect is enabled and screen sharing is detected, enable streamer mode
    chrome.storage.sync.get(['autoDetect'], function(result) {
      if (result.autoDetect && isScreenSharing) {
        // Enable streamer mode
        chrome.storage.sync.set({ streamerMode: true });
        
        // Notify all ChatGPT tabs
        chrome.tabs.query({url: 'https://chatgpt.com/*'}, function(tabs) {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, {
              action: 'toggleStreamerMode',
              enabled: true
            });
          });
        });
      } else if (result.autoDetect && !isScreenSharing) {
        // Disable streamer mode when screen sharing ends
        chrome.storage.sync.set({ streamerMode: false });
        
        // Notify all ChatGPT tabs
        chrome.tabs.query({url: 'https://chatgpt.com/*'}, function(tabs) {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, {
              action: 'toggleStreamerMode',
              enabled: false
            });
          });
        });
      }
    });
  }
  
  // Send response to confirm receipt
  sendResponse({status: 'success'});
  return true; // Keep the message channel open for async response
});
