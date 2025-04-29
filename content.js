// Content script for Streamer Mode for ChatGPT
// This script handles hiding/blurring the sidebar on chat.openai.com

console.log("Streamer Mode Content Script Loaded - Top Level");

// --- Early Execution: Site Detection & Initial Class Application ---
let earlyCurrentSite = null;
const earlySiteConfig = {
  chatgpt: { urlPattern: /https:\/\/chatgpt\.com\/.*/, siteId: 'chatgpt' },
  gemini: { urlPattern: /https:\/\/gemini\.google\.com\/app.*/, siteId: 'gemini' }
};

// Detect site immediately
for (const key in earlySiteConfig) {
  if (earlySiteConfig[key].urlPattern.test(window.location.href)) {
    earlyCurrentSite = earlySiteConfig[key].siteId;
    break;
  }
}

// Apply data-site attribute immediately to HTML element
if (earlyCurrentSite) {
  document.documentElement.dataset.site = earlyCurrentSite;
  console.log(`Early Detection: Site is ${earlyCurrentSite}`);

  // Immediately try to apply streamer-mode-active if settings exist
  // Note: Storage access is async, so this won't be truly instantaneous,
  // but it's earlier than waiting for DOMContentLoaded.
  chrome.storage.sync.get('streamerMode', (result) => {
    if (result.streamerMode) {
      document.documentElement.classList.add('streamer-mode-active');
      console.log('Early Application: streamer-mode-active class added to html.');
    }
  });
} else {
    console.log("Early Detection: Site not supported.");
}
// --- End Early Execution ---


// Use the same variable name for consistency later in the script
let currentSite = earlyCurrentSite;

const siteConfig = {
  chatgpt: {
    // urlPattern: /https:\/\/chatgpt\.com\/.*/, // Defined above
    selectors: {
      sidebar: 'nav[aria-label="Chat history"]',
      history: '#history',
      mainContent: 'main',
      messageContainerParent: '.flex.flex-col.items-center .w-full',
      messageContent: 'div[data-message-author-role] div.markdown.prose',
      panicTargets: ['main', 'nav[aria-label="Chat history"]'],
    }
  },
  gemini: {
    // urlPattern: /https:\/\/gemini\.google\.com\/app.*/, // Defined above
    selectors: {
      sidebar: 'bard-sidenav[role="navigation"]', 
      history: 'conversations-list', 
      mainContent: '.main-content', 
      messageContainerParent: 'div#chat-history', // Scroll container holds messages
      messageContent: 'message-content, message-paragraph, .markdown', // Combine potential elements
      panicTargets: ['.main-content', 'bard-sidenav[role="navigation"]'],
    }
  }
};

// Get current site's selectors
const SELECTORS = currentSite ? siteConfig[currentSite].selectors : {};

// --- State Variables ---
let isPanicModeActive = false;
let sidebarHoverListenersAttached = false; // Track hover listeners
const stableSidebarParentSelector = 'div.bg-token-sidebar-surface-primary.shrink-0'; // Define stable selector

// --- Sensitive Data Masking ---
const MASKING_PATTERNS = [
  { name: 'email', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { name: 'phone', regex: /(\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g },
  { name: 'apikey', regex: /[a-zA-Z0-9_\-]{20,}/g }
];
const MASKED_ELEMENT_CLASS = 'masked-data';
const MASKED_ELEMENT_TAG = 'span';

// Function to apply masking to a single text node
function maskTextNode(node) {
  let text = node.nodeValue;
  if (!text || text.length < 3 || /^\s+$/.test(text)) {
      return false;
  }
  let hasChanges = false;
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  MASKING_PATTERNS.forEach(patternInfo => {
      patternInfo.regex.lastIndex = 0;
      let match;
      let currentText = text; 
      let currentLastIndex = 0;
      let tempFragment = document.createDocumentFragment();
      let patternMadeChanges = false; // Track changes per pattern
      while ((match = patternInfo.regex.exec(currentText)) !== null) {
          if (match.index < currentLastIndex) {
              patternInfo.regex.lastIndex = currentLastIndex;
              continue;
          }
          hasChanges = true; // Mark global change
          patternMadeChanges = true; // Mark change for this pattern
          tempFragment.appendChild(document.createTextNode(currentText.substring(currentLastIndex, match.index)));
          const span = document.createElement(MASKED_ELEMENT_TAG);
          span.className = MASKED_ELEMENT_CLASS;
          span.dataset.patternName = patternInfo.name;
          span.textContent = match[0];
          tempFragment.appendChild(span);
          currentLastIndex = patternInfo.regex.lastIndex;
      }
      // If this pattern made changes, update the main fragment
      if (patternMadeChanges) {
        tempFragment.appendChild(document.createTextNode(currentText.substring(currentLastIndex)));
        fragment.appendChild(tempFragment);
        // Update text for next iteration (this is still imperfect for overlaps)
        // text = fragment.textContent; // Simple approach, might mangle things
      } else if (fragment.childNodes.length === 0 && lastIndex === 0) {
        // If no pattern has made changes yet, add the original text
        fragment.appendChild(document.createTextNode(text));
      }
      // How to handle text for next pattern is complex, sticking to basic sequential application
  });
  if (hasChanges && fragment.childNodes.length > 0) {
     if (fragment.childNodes.length === 1 && fragment.firstChild.nodeType === Node.TEXT_NODE && fragment.firstChild.nodeValue === node.nodeValue) {
         return false; 
     }
     try {
        // Check if parent exists before replacing
        if (node.parentNode) {
           node.parentNode.replaceChild(fragment, node);
           return true;
        } else {
           console.warn("[Masking] Node parent doesn't exist, cannot replace.", node);
           return false;
        }
     } catch (e) {
        console.error("[Masking] Error replacing node:", e, "Node:", node, "Parent:", node.parentNode, "Fragment:", fragment);
        return false;
     }
  }
  return false;
}

// Function to traverse nodes and apply masking
function traverseAndMask(containerNode) {
  const walker = document.createTreeWalker(containerNode, NodeFilter.SHOW_TEXT, null, false);
  let textNode;
  const nodesToProcess = [];
  while(textNode = walker.nextNode()) {
      const parentTag = textNode.parentNode.nodeName;
      if (parentTag !== MASKED_ELEMENT_TAG.toUpperCase() &&
          parentTag !== 'SCRIPT' &&
          parentTag !== 'STYLE') {
          // Extra check: Ensure parent exists before queueing
          if (textNode.parentNode) {
             nodesToProcess.push(textNode);
          }
      }
  }
  nodesToProcess.forEach(maskTextNode);
}

// (maskExistingMessages uses SELECTORS.messageContent)
function maskExistingMessages() {
  if (!SELECTORS.messageContent) {
      console.warn("[Masking] No message content selector defined for this site.");
      return;
  }
  console.log("[Masking] Applying initial mask to existing messages.");
  const messageContentNodes = document.querySelectorAll(SELECTORS.messageContent);
  console.log(`[Masking] Found ${messageContentNodes.length} existing message content nodes using selector: ${SELECTORS.messageContent}`);
  messageContentNodes.forEach(node => {
      traverseAndMask(node);
  });
}

// (MutationObserver setup remains the same)
let observerTimeout = null;
const debouncedMasking = (mutationsList) => {
    clearTimeout(observerTimeout);
    observerTimeout = setTimeout(() => {
        // Use documentElement class list now
        if (!document.documentElement.classList.contains('streamer-mode-active')) {
            return;
        }
        if (!SELECTORS.messageContent) return;
        // console.log('[Observer] Debounced processing of mutations:', mutationsList.length);
        let processed = false;
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const contentNodes = node.querySelectorAll(SELECTORS.messageContent);
                        if (contentNodes.length > 0) {
                            processed = true;
                            contentNodes.forEach(contentNode => {
                                traverseAndMask(contentNode);
                            });
                        } else if (node.matches && node.matches(SELECTORS.messageContent)) {
                            processed = true;
                            traverseAndMask(node);
                        }
                    }
                });
            }
            else if (mutation.type === 'characterData' && mutation.target.nodeType === Node.TEXT_NODE) {
                const parentElement = mutation.target.parentElement;
                if (parentElement && parentElement.closest && parentElement.closest(SELECTORS.messageContent)) {
                     if (mutation.oldValue && mutation.oldValue.trim() !== mutation.target.nodeValue.trim()) {
                         processed = true;
                         traverseAndMask(parentElement);
                     }
                }
            }
        }
        // if (processed) console.log('[Observer] Finished debounced processing.');
    }, 300);
};
const chatObserver = new MutationObserver(debouncedMasking);

// --- Sidebar Observer --- 
let sidebarObserverTimeout = null;
const debouncedSidebarCheck = (mutationsList) => {
    clearTimeout(sidebarObserverTimeout);
    sidebarObserverTimeout = setTimeout(() => {
        // console.log('[Sidebar Observer] Debounced processing of mutations:', mutationsList.length);
        // Check if streamer mode should be active and re-apply styles forcefully
        chrome.storage.sync.get(['streamerMode', 'hideCompletely'], (settings) => {
            if (settings.streamerMode && !isPanicModeActive) {
                // console.log('[Sidebar Observer] Re-applying styles due to mutation.');
                applyStreamerMode(true, settings.hideCompletely || false);
            }
        });
    }, 300);
};
const sidebarObserver = new MutationObserver(debouncedSidebarCheck);
// --- End Sidebar Observer ---

// (startChatObserver uses SELECTORS.messageContainerParent)
function startChatObserver() {
  if (!SELECTORS.messageContainerParent) {
      console.warn("[Observer] No message container parent selector defined for this site.");
      return;
  }
  const conversationContainer = document.querySelector(SELECTORS.messageContainerParent);
  if (conversationContainer) {
    console.log('[Observer] Starting chat observer on container:', conversationContainer);
    // Check documentElement class list now
    if (document.documentElement.classList.contains('streamer-mode-active')) {
        maskExistingMessages();
    }
    chatObserver.observe(conversationContainer, {
        childList: true,
        subtree: true,
        characterData: true,
        characterDataOldValue: true
    });
  } else {
      console.warn(`[Observer] Could not find conversation container (${SELECTORS.messageContainerParent}) to observe for masking. Retrying...`);
      setTimeout(startChatObserver, 1500);
  }
}

// (stopChatObserver remains the same)
function stopChatObserver() {
    console.log('[Observer] Stopping chat observer.');
    clearTimeout(observerTimeout);
    try {
        chatObserver.disconnect();
    } catch (e) {}
}

// Function to start the sidebar observer
function startSidebarObserver() {
    // Target the most likely stable parent container based on comparison
    const sidebarContainer = document.querySelector(stableSidebarParentSelector);

    if (sidebarContainer) {
        console.log('[Sidebar Observer] Starting observer on stable parent:', sidebarContainer);
        sidebarObserver.observe(sidebarContainer, {
            childList: true, // Watch for additions/removals of children (like the nav)
            subtree: true,   // Watch deeper changes within the sidebar content
            attributes: false
        });
    } else {
        console.warn(`[Sidebar Observer] Could not find stable sidebar parent (${stableSidebarParentSelector}) to observe. Retrying...`);
        // Check if streamer mode should be active before retrying
        chrome.storage.sync.get('streamerMode', (settings) => {
             if (settings.streamerMode && !isPanicModeActive) {
                setTimeout(startSidebarObserver, 1500);
             }
        });
    }
}

// Function to stop the sidebar observer
function stopSidebarObserver() {
    console.log('[Sidebar Observer] Stopping observer.');
    clearTimeout(sidebarObserverTimeout);
    try {
        sidebarObserver.disconnect();
    } catch (e) {}
}

// --- UI Elements and Toggling ---

// (createIndicator remains the same)
function createIndicator() {
  if (document.querySelector('.streamer-mode-indicator')) return;
  const indicator = document.createElement('div');
  indicator.className = 'streamer-mode-indicator';
  indicator.textContent = 'Streamer Mode Active';
  // Append to body once it exists
  if (document.body) {
      document.body.appendChild(indicator);
  } else {
      // Fallback if body not ready - unlikely with setTimeout in initialize
      document.addEventListener('DOMContentLoaded', () => {
          if (!document.querySelector('.streamer-mode-indicator')) { // Double check
  document.body.appendChild(indicator);
}
      });
  }
}

// Functions to handle sidebar hover effect directly
function handleSidebarMouseOver(event) {
    console.log('[Hover Debug] MouseOver Fired. Target:', event.target, 'CurrentTarget:', event.currentTarget);
    const sidebarContainer = event.currentTarget; // This is the element the listener is attached to

    // Unblur whenever the mouse enters the container area
    if (sidebarContainer && sidebarContainer.style.display !== 'none') { // Only change if not hidden
        console.log('[Hover Debug] Unblurring. Current filter:', sidebarContainer.style.filter, 'Current opacity:', sidebarContainer.style.opacity);
        sidebarContainer.style.setProperty('filter', 'blur(0)', 'important');
        sidebarContainer.style.setProperty('opacity', '1', 'important');
        console.log('[Hover Debug] Styles set to filter: blur(0), opacity: 1');
    } else {
        console.log('[Hover Debug] MouseOver - Sidebar container hidden or not found, doing nothing.');
    }
}

function handleSidebarMouseOut(event) {
    console.log('[Hover Debug] MouseOut Fired. Target:', event.target, 'CurrentTarget:', event.currentTarget, 'RelatedTarget:', event.relatedTarget);
    const sidebarContainer = event.currentTarget;
    const sidebarNavElement = document.querySelector(SELECTORS.sidebar);

    // Check where the mouse is moving TO
    const relatedTarget = event.relatedTarget;

    // Determine if the mouse is still within the sidebar area (container or nav)
    const stillInsideContainer = sidebarContainer && relatedTarget && sidebarContainer.contains(relatedTarget);
    const stillInsideNav = sidebarNavElement && relatedTarget && sidebarNavElement.contains(relatedTarget);

    console.log(`[Hover Debug] MouseOut check: stillInsideContainer=${stillInsideContainer}, stillInsideNav=${stillInsideNav}`);

    // Only re-blur if the mouse is moving completely outside the container and its nav content
    if (sidebarContainer && sidebarContainer.style.display !== 'none' && !stillInsideContainer && !stillInsideNav) {
        // Re-apply original blur/opacity only if streamer mode is still active (and not panic/hidden)
        chrome.storage.sync.get('streamerMode', (settings) => {
             if (settings.streamerMode && !isPanicModeActive && !document.body.classList.contains('hide-sidebar')) {
                 console.log('[Hover Debug] Re-blurring. Current filter:', sidebarContainer.style.filter, 'Current opacity:', sidebarContainer.style.opacity);
                 sidebarContainer.style.setProperty('filter', 'blur(10px)', 'important');
                 sidebarContainer.style.setProperty('opacity', '0.6', 'important');
                 console.log('[Hover Debug] Styles set to filter: blur(10px), opacity: 0.6');
             } else {
                  console.log('[Hover Debug] MouseOut - Not re-blurring (Streamer/Panic/Hidden state). Streamer:', settings.streamerMode, 'Panic:', isPanicModeActive, 'HiddenClass:', document.body.classList.contains('hide-sidebar'));
             }
        });
    } else {
         console.log('[Hover Debug] MouseOut - Mouse still inside sidebar area or sidebar hidden/not found, not re-blurring.');
    }
}

// Function to apply streamer mode
function applyStreamerMode(enabled, hideCompletely = false) {
  const htmlEl = document.documentElement;
  const bodyEl = document.body;
  if (!bodyEl) { 
      console.warn("applyStreamerMode called before body exists.");
      return; // Body might not be ready yet
  }
  if (isPanicModeActive) {
     console.log('Panic mode active, skipping streamer mode style changes.');
     return;
  }
  const currentlyEnabled = htmlEl.classList.contains('streamer-mode-active');
  const sidebarContainer = document.querySelector(stableSidebarParentSelector);

  // --- Manage Global Class and Observers ---
  if (enabled) {
    if (!currentlyEnabled) {
        console.log('Streamer Mode Enabling: Adding class and starting observers.');
        htmlEl.classList.add('streamer-mode-active');
        startChatObserver();
        startSidebarObserver();
    }
  } else {
    if (currentlyEnabled) {
        console.log('Streamer Mode Disabling: Removing class and stopping observers.');
        htmlEl.classList.remove('streamer-mode-active');
        stopChatObserver();
        stopSidebarObserver();
    }
  }

  // --- Apply Direct Styles to Sidebar Container ---
  if (sidebarContainer) {
      // Remove existing listeners first to avoid duplicates
      if (sidebarHoverListenersAttached) {
          console.log('[Hover Debug] Removing existing mouseover/mouseout listeners.');
          sidebarContainer.removeEventListener('mouseover', handleSidebarMouseOver);
          sidebarContainer.removeEventListener('mouseout', handleSidebarMouseOut);
          sidebarHoverListenersAttached = false;
      }

      if (enabled) {
          sidebarContainer.style.transition = 'filter 0.3s ease, opacity 0.3s ease, display 0s'; // Add display transition (0s)

          if (hideCompletely) {
              console.log('[Hover Debug] Applying hideCompletely styles.');
              sidebarContainer.style.filter = '';
              sidebarContainer.style.opacity = '';
              sidebarContainer.style.display = 'none';
              bodyEl.classList.add('hide-sidebar'); // Keep body class for potential CSS overrides elsewhere
          } else {
               console.log('[Hover Debug] Applying blur/dim styles.');
              sidebarContainer.style.setProperty('filter', 'blur(10px)', 'important');
              sidebarContainer.style.setProperty('opacity', '0.6', 'important');
              sidebarContainer.style.display = ''; // Ensure it's visible if switching from hide
              bodyEl.classList.remove('hide-sidebar');

              // Add hover listeners only if blurring/dimming
              console.log('[Hover Debug] Adding mouseover/mouseout listeners.');
              sidebarContainer.addEventListener('mouseover', handleSidebarMouseOver);
              sidebarContainer.addEventListener('mouseout', handleSidebarMouseOut);
              sidebarHoverListenersAttached = true;
          }
      } else {
          // Disable streamer mode: Clear all related inline styles and remove listeners
          console.log('[Hover Debug] Disabling streamer mode - clearing styles.');
          sidebarContainer.style.filter = '';
          sidebarContainer.style.opacity = '';
          sidebarContainer.style.display = '';
          sidebarContainer.style.transition = '';
          bodyEl.classList.remove('hide-sidebar');
          // Listeners already removed above if they were attached
          if (sidebarHoverListenersAttached) { // Ensure flag is false if disabled
              console.warn('[Hover Debug] Listeners were marked as attached during disable? Setting flag to false.');
              sidebarHoverListenersAttached = false;
          }
      }
  } else {
      console.warn(`Cannot apply direct styles: Stable sidebar container (${stableSidebarParentSelector}) not found.`);
      // If enabling and container not found, try again shortly
      if (enabled) {
          setTimeout(() => applyStreamerMode(enabled, hideCompletely), 500);
      }
  }
}

// Function to toggle panic mode visuals
function togglePanicVisuals(forceState) {
  const htmlEl = document.documentElement;
  const bodyEl = document.body;
  if (!bodyEl) return false; // Need body

  isPanicModeActive = typeof forceState === 'boolean' ? forceState : !isPanicModeActive;
  console.log(`Toggling panic mode visuals. New state: ${isPanicModeActive}`);

  if (isPanicModeActive) {
    htmlEl.classList.add('panic-mode-active'); // Add to html
    bodyEl.classList.add('panic-mode-active'); // Add to body too (CSS might target body)
    // Ensure normal streamer styles are visually off (including direct styles)
    const sidebarContainer = document.querySelector(stableSidebarParentSelector);
    if (sidebarContainer) {
        sidebarContainer.style.filter = '';
        sidebarContainer.style.opacity = '';
        sidebarContainer.style.display = '';
        sidebarContainer.style.transition = '';
        if (sidebarHoverListenersAttached) {
            sidebarContainer.removeEventListener('mouseover', handleSidebarMouseOver);
            sidebarContainer.removeEventListener('mouseout', handleSidebarMouseOut);
            sidebarHoverListenersAttached = false;
        }
    }
    htmlEl.classList.remove('streamer-mode-active');
    bodyEl.classList.remove('hide-sidebar');
    stopChatObserver(); // Stop masking
    stopSidebarObserver(); // Stop sidebar observer too
  } else {
    htmlEl.classList.remove('panic-mode-active');
    bodyEl.classList.remove('panic-mode-active');
    // Re-apply normal streamer mode state if needed
    chrome.storage.sync.get(['streamerMode', 'hideCompletely'], function(settings) {
       applyStreamerMode(settings.streamerMode || false, settings.hideCompletely || false);
    });
  }
  return isPanicModeActive;
}

// Initialize the extension
function initialize() {
  if (!currentSite || !document.body) { 
      // Wait for body if initialize was somehow called too early, 
      // or stop if site not supported
      if (!document.body) {
          console.log('Initialize: Waiting for body...');
          setTimeout(initialize, 50); 
      } else {
          console.log('Initialize: Site not supported, stopping initialization.');
      }
      return; 
  }
  
  // Check if already initialized (via runInitialize flag)
  if (document.body.dataset.streamerInit === 'true') return;
  document.body.dataset.streamerInit = 'true';

  createIndicator();
  
  // Ready check element selector
  const readyElementSelector = SELECTORS.history || SELECTORS.sidebar || SELECTORS.mainContent;
  if (!readyElementSelector || !document.querySelector(readyElementSelector)) {
      console.log(`Initialization: Waiting for ready element (${readyElementSelector}) to appear...`);
      // Clear init flag so we can retry
      document.body.dataset.streamerInit = 'false'; 
      setTimeout(initialize, 750); 
    return;
  }
  
  console.log('Extension Initializing fully for site:', currentSite);
  // Re-apply based on current storage state (early application might have missed changes)
  chrome.storage.sync.get(['streamerMode', 'hideCompletely'], function(result) {
    console.log('Applying settings during full initialization:', result);
    applyStreamerMode(result.streamerMode || false, result.hideCompletely || false);
  });
}

// Listen for messages from popup or background script
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (!currentSite) {
      sendResponse({ status: 'error', message: 'Site not supported' });
      return true;
  }
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
  } else if (request.action === 'getPanicState') { // Added listener for getting panic state
      response = { panicModeEnabled: isPanicModeActive };
      status = 'success';
  }
  
  // Send response to confirm receipt and provide state if needed
  sendResponse({ status: status, ...response });
  return true; // Keep the message channel open for async response if needed
});

// Use a flag to ensure initialize runs only once via setTimeout
let initTimeoutScheduled = false;
if (currentSite && !initTimeoutScheduled) {
    initTimeoutScheduled = true;
    // Delay initialization slightly to ensure body and initial elements are more likely present
    setTimeout(initialize, 100); 
}
