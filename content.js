// Content script for Streamer Mode for ChatGPT
// This script handles hiding/blurring the sidebar on chat.openai.com

let isPanicModeActive = false; // Track panic mode state locally

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

// --- Sensitive Data Masking --- 

const MASKING_PATTERNS = [
  // Email Address
  { name: 'email', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  // Basic US Phone Number (various formats) - Adjust for international if needed
  { name: 'phone', regex: /(\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g },
  // Example API Key Pattern (adjust as needed - very basic)
  // { name: 'apikey', regex: /[a-zA-Z0-9_-]{20,}/g } 
];

const MASKED_ELEMENT_CLASS = 'masked-data';
const MASKED_ELEMENT_TAG = 'span';

// Function to apply masking to a single text node
function maskTextNode(node) {
  let text = node.nodeValue;
  let hasChanges = false;
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;

  // Create a combined regex for efficiency if needed, or iterate
  MASKING_PATTERNS.forEach(patternInfo => {
      // Reset lastIndex for each pattern if applying sequentially
      patternInfo.regex.lastIndex = 0; 
      let match;
      // Important: We need to re-evaluate based on changes made by previous patterns
      // This simple loop won't handle overlapping matches from different patterns well.
      // A more robust approach would find all matches first, sort them, then process.
      // For now, let's keep it simple, focusing on non-overlapping cases.
      while ((match = patternInfo.regex.exec(text)) !== null) {
          hasChanges = true;
          // Add text before the match
          if (match.index > lastIndex) {
              fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
          }
          // Create and add the masked span
          const span = document.createElement(MASKED_ELEMENT_TAG);
          span.className = MASKED_ELEMENT_CLASS;
          span.dataset.patternName = patternInfo.name; // Store which pattern matched
          span.textContent = match[0];
          fragment.appendChild(span);
          lastIndex = patternInfo.regex.lastIndex;
      }
  });

  // If changes were made, replace the node
  if (hasChanges) {
    // Add any remaining text after the last match
    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
    }
    node.parentNode.replaceChild(fragment, node);
    return true; // Indicate that the node was replaced
  }
  return false; // No changes made
}

// Function to traverse nodes and apply masking
function traverseAndMask(node) {
  // Target elements likely containing user/assistant messages (adjust selectors as needed)
  // Common ChatGPT selectors might involve divs with specific classes like 'text-base', 'prose', etc.
  const messageSelectors = '.text-base, .prose, [class*="markdown"]'
  if (!node.matches || !node.matches(messageSelectors)) {
      // If the node itself isn't a message container, check its children
      if (node.childNodes && node.childNodes.length > 0) {
          // Iterate backwards since maskTextNode can replace nodes
          for (let i = node.childNodes.length - 1; i >= 0; i--) {
              traverseAndMask(node.childNodes[i]);
          }
      }
      return;
  }

  // If the node *is* a message container, process its text nodes
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null, false);
  let textNode;
  // Need to store nodes to process because the walker is live and node replacement messes it up
  const nodesToProcess = [];
  while(textNode = walker.nextNode()) {
      // Avoid masking text within already masked spans or script/style tags
      if (textNode.parentNode.nodeName !== MASKED_ELEMENT_TAG.toUpperCase() && 
          textNode.parentNode.nodeName !== 'SCRIPT' && 
          textNode.parentNode.nodeName !== 'STYLE') {
          nodesToProcess.push(textNode);
      }
  }

  // Process the collected text nodes
  nodesToProcess.forEach(maskTextNode);
}


// MutationObserver to watch for new messages
const chatObserver = new MutationObserver((mutationsList) => {
  // Only run if streamer mode is active
  if (!document.body.classList.contains('streamer-mode-active')) {
      return; // Don't mask if streamer mode is off
  }
  
  for (const mutation of mutationsList) {
    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Traverse the new node and its children to mask content
          traverseAndMask(node);
        }
      });
    }
    // Optional: Handle characterData mutations if needed for edits, but can be performance heavy
    // else if (mutation.type === 'characterData') { ... }
  }
});

// Function to start observing the chat area
function startChatObserver() {
  // Find the main chat container (adjust selector if needed)
  const chatContainer = document.querySelector('main'); // Or a more specific inner element
  if (chatContainer) {
    console.log('Starting chat observer for masking.');
    // Initial mask of existing content when observer starts (and streamer mode is on)
    if (document.body.classList.contains('streamer-mode-active')) {
        console.log('Initial masking of existing content.');
        traverseAndMask(chatContainer);
    }
    chatObserver.observe(chatContainer, { 
        childList: true, 
        subtree: true 
        // characterData: true // Add if needed, but be cautious
    });
  } else {
      console.warn('Could not find chat container to observe for masking. Retrying...');
      setTimeout(startChatObserver, 1000); // Retry if container not found yet
  }
}

// --- End Sensitive Data Masking --- 

// Function to apply streamer mode
function applyStreamerMode(enabled, hideCompletely = false) {
  const body = document.body;
  
  // Panic mode overrides normal streamer mode visuals
  if (isPanicModeActive) {
     console.log('Panic mode is active, skipping normal streamer mode style changes.');
     return;
  }

  const currentlyEnabled = body.classList.contains('streamer-mode-active');

  if (enabled) {
    body.classList.add('streamer-mode-active');
    if (hideCompletely) {
      body.classList.add('hide-sidebar');
    } else {
      body.classList.remove('hide-sidebar');
    }
    // If turning ON, trigger initial mask/observer start
    if (!currentlyEnabled) {
        startChatObserver(); // This will check body class again inside
    }
  } else {
    body.classList.remove('streamer-mode-active', 'hide-sidebar');
    // If turning OFF, we might want to unmask existing elements
    // Or just let the CSS handle visuals and don't modify DOM further
    // Let's rely on CSS: removing streamer-mode-active will unblur via CSS.
  }
}

// Function to toggle panic mode visuals
function togglePanicVisuals(forceState) {
  const body = document.body;
  // Toggle state if forceState is not provided
  isPanicModeActive = typeof forceState === 'boolean' ? forceState : !isPanicModeActive;
  console.log(`Toggling panic mode visuals. New state: ${isPanicModeActive}`);
  if (isPanicModeActive) {
    body.classList.add('panic-mode-active');
    // Ensure normal streamer styles are removed if panic is activated
    body.classList.remove('streamer-mode-active', 'hide-sidebar');
  } else {
    body.classList.remove('panic-mode-active');
    // Re-apply normal streamer mode if needed after panic mode is turned off
    chrome.storage.sync.get(['streamerMode', 'hideCompletely'], function(settings) {
       applyStreamerMode(settings.streamerMode || false, settings.hideCompletely || false);
    });
  }
  return isPanicModeActive; // Return the new state
}

// Initialize the extension
function initialize() {
  // Create the indicator element
  createIndicator();
  
  // Check if sidebar exists, if not, try again later (page might still be loading)
  const sidebar = getSidebar();

  // If sidebar isn't ready, wait.
  if (!sidebar) {
    setTimeout(initialize, 500);
    return;
  }
  
  // Load saved settings
  chrome.storage.sync.get(['streamerMode', 'hideCompletely'], function(result) {
    // Apply initial streamer mode (will also trigger observer start if enabled)
    applyStreamerMode(result.streamerMode || false, result.hideCompletely || false);
  });
}

// Listen for messages from popup or background script
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  let status = 'success';
  let response = {};

  if (request.action === 'toggleStreamerMode') {
    // Apply streamer mode only if panic mode isn't active
    if (!isPanicModeActive) {
      applyStreamerMode(request.enabled, request.hideCompletely || false);
    } else {
      console.log('Ignoring toggleStreamerMode message because Panic Mode is active.');
    }
  } else if (request.action === 'togglePanicMode') {
    const newState = togglePanicVisuals();
    response = { panicModeEnabled: newState };
  }
  
  // Send response to confirm receipt and provide state if needed
  sendResponse({ status: status, ...response });
  return true; // Keep the message channel open for async response if needed
});

// Initialize when the page is fully loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
