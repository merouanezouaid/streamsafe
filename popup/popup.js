// Popup script to handle toggle functionality
document.addEventListener('DOMContentLoaded', function() {
  const streamerModeToggle = document.getElementById('streamerModeToggle');
  const autoDetectToggle = document.getElementById('autoDetectToggle');
  const statusText = document.getElementById('statusText');
  
  // Load saved settings
  chrome.storage.sync.get(['streamerMode', 'autoDetect'], function(result) {
    // Set toggle states based on saved settings
    streamerModeToggle.checked = result.streamerMode || false;
    autoDetectToggle.checked = result.autoDetect || false;
    
    // Update status text
    updateStatusText(result.streamerMode || false);
  });
  
  // Handle streamer mode toggle
  streamerModeToggle.addEventListener('change', function() {
    const isEnabled = this.checked;
    
    // Save setting
    chrome.storage.sync.set({ streamerMode: isEnabled });
    
    // Update status text
    updateStatusText(isEnabled);
    
    // Send message to content script
    chrome.tabs.query({url: 'https://chatgpt.com/*'}, function(tabs) {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { 
          action: 'toggleStreamerMode', 
          enabled: isEnabled 
        });
      });
    });
    
    // Send message to background script
    chrome.runtime.sendMessage({
      action: 'updateStreamerMode',
      enabled: isEnabled
    });
  });
  
  // Handle auto-detect toggle
  autoDetectToggle.addEventListener('change', function() {
    const isEnabled = this.checked;
    
    // Save setting
    chrome.storage.sync.set({ autoDetect: isEnabled });
    
    // Send message to background script
    chrome.runtime.sendMessage({
      action: 'updateAutoDetect',
      enabled: isEnabled
    });
  });
  
  // Function to update status text
  function updateStatusText(isEnabled) {
    if (isEnabled) {
      statusText.textContent = 'ON';
      statusText.classList.add('on');
      statusText.classList.remove('off');
    } else {
      statusText.textContent = 'OFF';
      statusText.classList.add('off');
      statusText.classList.remove('on');
    }
  }
});
