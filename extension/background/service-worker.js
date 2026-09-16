/**
 * Background Service Worker (Manifest V3)
 * Manages Offscreen Document lifecycle, tab capture, multi-frame message routing,
 * and side panel behavior.
 */

const OFFSCREEN_DOCUMENT_PATH = 'offscreen/offscreen.html';

// Setup Side Panel to open automatically when action icon is clicked
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('[VisionAgent:SW] Error setting panel behavior:', err));

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[VisionAgent:SW] Extension installed: ${details.reason}`);
  // Store default extension settings
  await chrome.storage.local.set({
    voiceEnabled: true,
    privacyLevel: 'strict',
    installedAt: Date.now()
  });
});

/**
 * Ensures a single offscreen document is active for OpenCV visual processing
 */
async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [chrome.offscreen.Reason.BLOBS, chrome.offscreen.Reason.DOM_PARSER],
    justification: 'Run OpenCV.js WebAssembly for client-side visual PII blurring and redaction'
  });

  console.log('[VisionAgent:SW] Created Offscreen Document for OpenCV processing');
}

async function hasOffscreenDocument() {
  if ('getContexts' in chrome.runtime) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
    });
    return contexts.length > 0;
  }
  // Fallback for older Chromium versions
  return false;
}

/**
 * Message Passing Router
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return false;

  (async () => {
    try {
      switch (message.action) {
        case 'CAPTURE_AND_REDACT': {
          // 1. Find the target web page tab (skipping internal chrome:// and chrome-extension:// tabs)
          const allTabs = await chrome.tabs.query({ lastFocusedWindow: true });
          let tab = allTabs.find(t => t.active && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'));
          if (!tab) {
            tab = allTabs.find(t => !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'));
          }

          if (!tab || !tab.id) {
            sendResponse({ 
              ok: false, 
              error: 'Please open or focus a web page (e.g. the benchmark test page or any website). Extensions cannot capture internal chrome:// pages.' 
            });
            return;
          }

          // 2. Capture visible tab image as DataURL with automatic fallback
          let rawDataUrl = null;
          try {
            rawDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
          } catch (captureErr) {
            console.warn('[VisionAgent:SW] captureVisibleTab failed, auto-injecting content script fallback:', captureErr.message);
            try {
              // Ensure content script is injected before requesting fallback screenshot
              await chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                files: ['content/playwright_driver.js', 'content/content-script.js']
              });
              const fallbackResp = await chrome.tabs.sendMessage(tab.id, { action: 'GENERATE_FALLBACK_SCREENSHOT' });
              if (fallbackResp && fallbackResp.ok) {
                rawDataUrl = fallbackResp.dataUrl;
              }
            } catch (fbErr) {
              console.warn('[VisionAgent:SW] Fallback capture also failed:', fbErr.message);
            }
          }

          if (!rawDataUrl) {
            sendResponse({ 
              ok: false, 
              error: "Cannot capture tab. If viewing a local file:// URL, enable 'Allow access to file URLs' in chrome://extensions -> Details, or run http://localhost:5000" 
            });
            return;
          }

          // 2. Query elements and PII rects from all frames in tab
          let framesData = [];
          try {
            const resp = await chrome.tabs.sendMessage(tab.id, { action: 'SCAN_VIEWPORT' });
            if (resp && resp.ok) {
              framesData.push(resp);
            }
          } catch (err) {
            // Tab was opened before extension reload or injection pending: auto-inject now!
            try {
              await chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                files: ['content/playwright_driver.js', 'content/content-script.js']
              });
              const retryResp = await chrome.tabs.sendMessage(tab.id, { action: 'SCAN_VIEWPORT' });
              if (retryResp && retryResp.ok) {
                framesData.push(retryResp);
              }
            } catch (injectErr) {
              console.warn('[VisionAgent:SW] Could not scan or inject tab elements:', injectErr.message);
            }
          }

          // Aggregate PII rects and interactive elements across all frames
          const allPiiRects = [];
          const allElements = [];
          for (const fd of framesData) {
            if (Array.isArray(fd.piiRects)) allPiiRects.push(...fd.piiRects);
            if (Array.isArray(fd.elements)) allElements.push(...fd.elements);
          }

          // 3. Ensure Offscreen Document is loaded
          await ensureOffscreenDocument();

          // 4. Dispatch to Offscreen OpenCV for blurring and blackout masking
          const redactResp = await chrome.runtime.sendMessage({
            target: 'offscreen',
            action: 'REDACT_SCREEN',
            dataUrl: rawDataUrl,
            piiRects: allPiiRects,
            dpr: 1
          });

          if (!redactResp || !redactResp.ok) {
            throw new Error(redactResp?.error || 'Offscreen OpenCV redaction did not return a valid frame');
          }

          sendResponse({
            ok: true,
            tabId: tab.id,
            url: tab.url,
            rawScreenshot: rawDataUrl,
            sanitizedScreenshot: redactResp.sanitizedDataUrl || rawDataUrl,
            faceCount: redactResp.faceCount || 0,
            piiCount: redactResp.piiCount || 0,
            elements: allElements,
            redactionLatencyMs: redactResp.latencyMs || 0
          });
          break;
        }

        case 'EXECUTE_PAGE_TOOL': {
          const { tabId, tool, id, value, key, direction } = message;
          const targetTabId = tabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;

          if (!targetTabId) {
            sendResponse({ ok: false, error: 'No valid tabId for tool execution' });
            return;
          }

          // Broadcast tool command to all frames in the tab; the frame owning targetId will execute
          let execResp = null;
          try {
            execResp = await chrome.tabs.sendMessage(targetTabId, {
              action: 'EXECUTE_TOOL',
              tool,
              id,
              value,
              key,
              direction
            });
          } catch (execErr) {
            // Auto-inject and retry
            await chrome.scripting.executeScript({
              target: { tabId: targetTabId, allFrames: true },
              files: ['content/playwright_driver.js', 'content/content-script.js']
            });
            execResp = await chrome.tabs.sendMessage(targetTabId, {
              action: 'EXECUTE_TOOL',
              tool,
              id,
              value,
              key,
              direction
            });
          }

          sendResponse({ ok: true, result: execResp });
          break;
        }

        default:
          sendResponse({ ok: false, error: 'Unknown background action' });
      }
    } catch (err) {
      console.error('[VisionAgent:SW] Router error:', err);
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true; // Keep message channel open for async response
});
