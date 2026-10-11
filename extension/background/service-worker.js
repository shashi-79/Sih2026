/**
 * Background Service Worker: Gemma 4 Autonomous Browser Controller (Manifest V3)
 * Manages Offscreen WebGPU lifecycle, tab orchestration, and tool execution dispatching.
 */

const OFFSCREEN_DOCUMENT_PATH = 'offscreen/offscreen.html';

// Open Side Panel when extension icon is clicked
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[Gemma4:SW] Extension initialized: ${details.reason}`);
  await chrome.storage.local.set({
    voiceEnabled: true,
    autoAudioFeedback: true,
    modelBackend: 'hybrid', // 'webgpu' | 'ollama' | 'hybrid'
    ollamaEndpoint: 'http://localhost:11434',
    installedAt: Date.now()
  });
});

/**
 * Ensures Offscreen Document exists for WebGPU inference
 */
async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.BLOBS],
    justification: 'Run Gemma 4 on-device WebGPU inference without blocking extension UI'
  });
  console.log('[Gemma4:SW] Created Offscreen Document for WebGPU inference');
}

async function hasOffscreenDocument() {
  if ('getContexts' in chrome.runtime) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
    });
    return contexts.length > 0;
  }
  return false;
}

/**
 * Ensures content script is injected into target tab
 */
async function ensureContentScriptInjected(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: ['content/playwright_driver.js', 'content/content-script.js']
    });
  } catch (err) {
    // Already injected or restricted page
  }
}

/**
 * Persistent Keep-Alive Port for Sidepanel
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'gemma-agent-keepalive') {
    port.onMessage.addListener((msg) => {
      if (msg && msg.type === 'PING') {
        port.postMessage({ type: 'PONG', ts: Date.now() });
      }
    });
  }
});

/**
 * Message Dispatcher
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return false;
  if (message.target && message.target !== 'background') return false;

  (async () => {
    try {
      switch (message.action) {
        case 'GET_ACTIVE_PAGE_STATE': {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!activeTab || !activeTab.id || activeTab.url.startsWith('chrome://')) {
            sendResponse({
              ok: false,
              error: 'Cannot control internal browser chrome:// pages. Open an external or local webpage.'
            });
            return;
          }

          await ensureContentScriptInjected(activeTab.id);

          try {
            const pageState = await chrome.tabs.sendMessage(activeTab.id, {
              action: 'SCAN_PAGE_STATE',
              showBadges: message.showBadges !== false
            });
            sendResponse({ ok: true, tab: activeTab, state: pageState });
          } catch (e) {
            // Retry injection once
            await ensureContentScriptInjected(activeTab.id);
            const retryState = await chrome.tabs.sendMessage(activeTab.id, {
              action: 'SCAN_PAGE_STATE',
              showBadges: message.showBadges !== false
            });
            sendResponse({ ok: true, tab: activeTab, state: retryState });
          }
          break;
        }

        case 'EXECUTE_PAGE_TOOL': {
          const { tabId, tool, target, value, key, direction, url } = message;
          let targetTabId = tabId;

          if (!targetTabId) {
            const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            targetTabId = currentTab?.id;
          }

          if (!targetTabId) {
            sendResponse({ ok: false, error: 'No active tab found for tool execution' });
            return;
          }

          if (tool === 'navigate' && url) {
            await chrome.tabs.update(targetTabId, { url });
            sendResponse({ ok: true, tool: 'navigate', url });
            return;
          }

          await ensureContentScriptInjected(targetTabId);
          const toolResult = await chrome.tabs.sendMessage(targetTabId, {
            action: 'EXECUTE_TOOL',
            tool,
            target,
            value,
            key,
            direction,
            url
          });

          sendResponse(toolResult);
          break;
        }

        case 'CLEAR_PAGE_BADGES': {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab && tab.id && !tab.url.startsWith('chrome://')) {
            try {
              await chrome.tabs.sendMessage(tab.id, { action: 'CLEAR_BADGES' });
            } catch (_) {}
          }
          sendResponse({ ok: true });
          break;
        }

        case 'RUN_GEMMA_INFERENCE': {
          await ensureOffscreenDocument();
          const inferResp = await chrome.runtime.sendMessage({
            target: 'offscreen',
            action: 'INFER',
            prompt: message.prompt,
            systemPrompt: message.systemPrompt,
            temperature: message.temperature,
            maxTokens: message.maxTokens
          });
          sendResponse(inferResp);
          break;
        }

        default:
          sendResponse({ ok: false, error: 'Unknown background action' });
      }
    } catch (err) {
      console.error('[Gemma4:SW] Error:', err);
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true;
});
