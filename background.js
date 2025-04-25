// Background script for Streamer Mode for ChatGPT
// Handles communication between popup and content scripts and keyboard shortcuts

// Define the target URL pattern directly
const CHATGPT_URL_PATTERN = 'https://chatgpt.com/*';

// Initialize default settings
chrome.runtime.onInstalled.addListener(function() {
  chrome.storage.sync.set({
    streamerMode: false,
    autoDetect: false, // Keep this, even if non-functional, to prevent errors if UI isn't removed yet
    hideCompletely: false
  });
});

// Function to update streamer mode state and notify content scripts
function setStreamerModeState(enabled) {
  chrome.storage.sync.get(['hideCompletely'], (settings) => {
    chrome.storage.sync.get(['streamerMode'], (current) => {
      if (current.streamerMode === enabled) return;
      chrome.storage.sync.set({ streamerMode: enabled }, () => {
        console.log(`Streamer mode ${enabled ? 'enabled' : 'disabled'}. Notifying tabs.`);
        // Query using the single URL pattern constant
        chrome.tabs.query({ url: CHATGPT_URL_PATTERN }, function(tabs) {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, {
              action: 'toggleStreamerMode',
              enabled: enabled,
              hideCompletely: settings.hideCompletely || false
            }).catch(error => console.log(`Could not send message to tab ${tab.id}: ${error.message}`));
          });
        });
      });
    });
  });
}

// NOTE: Removing the non-functional auto-detect listeners (tabCapture, tabs.onUpdated) for clarity
/*
chrome.tabCapture.onStatusChanged.addListener(function(info) { ... });
chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) { ... });
*/

// Listen for messages from popup
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'updateStreamerMode') {
    setStreamerModeState(request.enabled);
  } else if (request.action === 'updateAutoDetect') {
    // Listener remains but does nothing functional to prevent errors
    // if the UI toggle still sends messages before it's removed.
    console.log('Received updateAutoDetect message (feature disabled).');
    // We don't enable/disable streamerMode based on this anymore.
  }

  Promise.resolve({ status: 'success' }).then(sendResponse);
  return true;
});

// Listen for keyboard shortcut command
chrome.commands.onCommand.addListener(function(command) {
  if (command === "toggle-panic-mode") {
    console.log('[Command] Toggle Panic Mode received');
    // Query using the single URL pattern constant
    chrome.tabs.query({ url: CHATGPT_URL_PATTERN, active: true, currentWindow: true }, function(tabs) {
      if (tabs && tabs.length > 0 && tabs[0].id) {
        const tabId = tabs[0].id;
        chrome.tabs.sendMessage(tabId, { action: 'togglePanicMode' })
          .then(response => {
             if (response) {
               console.log(`[Command] Panic mode toggled for tab ${tabId}. New state: ${response.panicModeEnabled ? 'ON' : 'OFF'}`);
             } else {
               console.error(`[Command] No response from content script on tab ${tabId}.`);
             }
          })
          .catch(error => console.error(`[Command] Error sending togglePanicMode to tab ${tabId}: ${error.message}`));
      } else {
        console.log('[Command] No active ChatGPT tab found for pattern:', CHATGPT_URL_PATTERN);
      }
    });
  }
});
