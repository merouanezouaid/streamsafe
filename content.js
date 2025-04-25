// Content script for Streamer Mode for ChatGPT
// This script handles hiding/blurring the sidebar on chat.openai.com

// Create streamer mode indicator element
function createIndicator() {
  const indicator = document.createElement('div');
  indicator.className = 'streamer-mode-indicator';
  indicator.textContent = 'Streamer Mode Active';
  document.body.appendChild(indicator);
}

// Function to identify the sidebar element
function getSidebar() {
  // ChatGPT's sidebar structure might change, so we use multiple selectors
  return document.querySelector('nav.nav-sidebar, .dark nav, nav[aria-label="Chat history"]');
}

// Function to apply streamer mode
function applyStreamerMode(enabled, hideCompletely = false) {
  const body = document.body;
  
  if (enabled) {
    body.classList.add('streamer-mode-active');
    body.classList.add('streamer-mode-history-hidden');
    if (hideCompletely) {
      body.classList.add('hide-sidebar');
    } else {
      body.classList.remove('hide-sidebar');
    }
  } else {
    body.classList.remove('streamer-mode-active', 'hide-sidebar', 'streamer-mode-history-hidden');
  }
}

// Initialize the extension
function initialize() {
  // Create the indicator element
  createIndicator();
  
  // Check if sidebar exists, if not, try again later (page might still be loading)
  const sidebar = getSidebar();
  const history = document.getElementById('history');

  // If sidebar or history isn't ready, wait.
  if (!sidebar || !history) { 
    setTimeout(initialize, 500);
    return;
  }
  
  // Load saved settings
  chrome.storage.sync.get(['streamerMode', 'hideCompletely'], function(result) {
    // Apply streamer mode based on saved settings
    applyStreamerMode(result.streamerMode || false, result.hideCompletely || false);
  });
}

// Listen for messages from popup or background script
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'toggleStreamerMode') {
    applyStreamerMode(request.enabled, request.hideCompletely || false);
  }
  
  // Send response to confirm receipt
  sendResponse({status: 'success'});
  return true; // Keep the message channel open for async response
});

// Initialize when the page is fully loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
