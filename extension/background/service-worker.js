/**
 * Background Service Worker: Gemma 4 Full-Power Browser Controller (Manifest V3)
 * Full browser controls: tabs, navigation, history, zoom, downloads, bookmarks, DOM tools.
 */

importScripts('cdp_controller.js');

// Open Side Panel on action click
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[Gemma4:SW] Extension initialized: ${details.reason}`);
  await chrome.storage.local.set({
    voiceEnabled: true,
    autoAudioFeedback: true,
    installedAt: Date.now()
  });
  await setupDeclarativeNetRules();
  await ensureOffscreenDocument();
});

chrome.runtime.onStartup.addListener(() => {
  setupDeclarativeNetRules();
});

// Configure immediately on worker activation
setupDeclarativeNetRules();

/**
 * Ensures Ollama local requests are never blocked by CORS Origin checks
 */
async function setupDeclarativeNetRules() {
  if (chrome.declarativeNetRequest && chrome.declarativeNetRequest.updateDynamicRules) {
    try {
      const rules = [
        {
          id: 11434,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'Origin', operation: 'set', value: 'http://127.0.0.1:11434' }
            ]
          },
          condition: {
            urlFilter: 'http://127.0.0.1:11434/*',
            resourceTypes: ['xmlhttprequest', 'other']
          }
        }
      ];
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [11434],
        addRules: rules
      });
      console.log('[Gemma4:SW] Ollama local CORS Origin rule configured');
    } catch (err) {
      console.warn('[Gemma4:SW] declarativeNetRequest notice:', err);
    }
  }
}

/**
 * Manages WebGPU Offscreen document lifecycle
 */
async function ensureOffscreenDocument() {
  if (chrome.offscreen) {
    try {
      if (await chrome.offscreen.hasDocument()) return;
      await chrome.offscreen.createDocument({
        url: 'offscreen/offscreen.html',
        reasons: ['WORKERS'],
        justification: 'Gemma 4 WebGPU offline inference worker'
      });
      console.log('[Gemma4:SW] Offscreen inference document active');
    } catch (err) {
      // Document already active or offscreen not supported
    }
  }
}

/**
 * Finds the user's active tab in the current focused window, avoiding extension frames
 */
async function getTargetWebTab() {
  try {
    const isWeb = (t) => t && t.id && (!t.url || (!t.url.startsWith('chrome-extension://') && !t.url.startsWith('devtools://')));
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const webTabs = (tabs || []).filter(isWeb);
    if (webTabs.length > 0) return webTabs[0];

    const anyActive = await chrome.tabs.query({ active: true });
    const anyWeb = (anyActive || []).filter(isWeb);
    if (anyWeb.length > 0) return anyWeb[0];

    const allTabs = await chrome.tabs.query({});
    const allWeb = (allTabs || []).filter(isWeb);
    return allWeb[0] || allTabs[0] || null;
  } catch (e) {
    return null;
  }
}

/**
 * Ensures content script is injected into target tab if not already present
 */
async function ensureContentScriptInjected(tabId) {
  if (!tabId) return;
  try {
    const probe = await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      func: () => !!(window.PlaywrightDriver && window.__gemma_agent_injected__)
    });
    if (probe && probe[0] && probe[0].result) {
      return; // Already initialized in tab
    }
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: ['content/playwright_driver.js', 'content/content-script.js']
    });
  } catch (err) {
    // Restricted internal page or already present
  }
}

/**
 * Waits for a tab to finish loading (status === 'complete')
 */
function waitForTabComplete(tabId, timeoutMs = 7000) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        try { chrome.tabs.onUpdated.removeListener(listener); } catch (_) {}
        resolve();
      }
    }, timeoutMs);

    function listener(updatedId, info) {
      if (updatedId === tabId && info.status === 'complete') {
        if (!done) {
          done = true;
          clearTimeout(timer);
          try { chrome.tabs.onUpdated.removeListener(listener); } catch (_) {}
          resolve();
        }
      }
    }

    try {
      chrome.tabs.onUpdated.addListener(listener);
    } catch (_) {
      resolve();
    }
  });
}

/**
 * Normalizes URL strings ensuring valid protocol
 */
function normalizeUrl(rawUrl) {
  if (!rawUrl) return 'https://www.google.com';
  let clean = rawUrl.trim();
  if (!/^https?:\/\//i.test(clean)) {
    clean = `https://${clean}`;
  }
  return clean;
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
 * Main Message Router for Browser & Page Tools
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) {
    sendResponse({ ok: false, error: 'Empty message' });
    return false;
  }
  if (message.target && message.target !== 'background') {
    if (message.target === 'offscreen') {
      ensureOffscreenDocument().catch(() => {});
    }
    return false;
  }

  (async () => {
    try {
      switch (message.action) {
        // --- 0. OLLAMA LOCAL PROXY (BYPASSES EXTENSION CORS RESTRICTIONS) ---
        case 'OLLAMA_TAGS': {
          try {
            const rawUrl = (message.url || 'http://127.0.0.1:11434').replace(/\/+$/, '');
            const ip4 = rawUrl.replace('localhost', '127.0.0.1');
            let resp = null;
            try {
              resp = await fetch(`${ip4}/api/tags`, { signal: AbortSignal.timeout(3000) });
            } catch (_) {
              resp = await fetch(`${rawUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
            }

            if (resp && resp.ok) {
              const data = await resp.json();
              sendResponse({ ok: true, models: data.models || [] });
            } else {
              sendResponse({ ok: false, error: resp ? `HTTP ${resp.status}` : 'No response' });
            }
          } catch (e) {
            sendResponse({ ok: false, error: e.message });
          }
          break;
        }

        case 'OLLAMA_CHAT': {
          try {
            const rawUrl = (message.url || 'http://127.0.0.1:11434').replace(/\/+$/, '');
            const ip4 = rawUrl.replace('localhost', '127.0.0.1');
            const chatPayload = {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: message.model || 'gemma4:e2b',
                messages: message.messages || [],
                stream: false,
                format: 'json',
                options: message.options || { temperature: 0.2, num_predict: 350 }
              })
            };

            let resp = null;
            try {
              resp = await fetch(`${ip4}/api/chat`, { ...chatPayload, signal: AbortSignal.timeout(60000) });
            } catch (_) {
              resp = await fetch(`${rawUrl}/api/chat`, { ...chatPayload, signal: AbortSignal.timeout(60000) });
            }

            if (resp && resp.ok) {
              const data = await resp.json();
              sendResponse({ ok: true, data });
            } else {
              sendResponse({ ok: false, error: resp ? `HTTP ${resp.status}` : 'No response' });
            }
          } catch (e) {
            sendResponse({ ok: false, error: e.message });
          }
          break;
        }

        // --- 1. TAB & PAGE STATE ---
        case 'GET_ACTIVE_PAGE_STATE': {
          let activeTab = null;
          if (message.tabId) {
            try {
              activeTab = await chrome.tabs.get(message.tabId);
            } catch (_) {}
          }
          if (!activeTab || !activeTab.id) {
            activeTab = await getTargetWebTab();
          }
          if (!activeTab || !activeTab.id) {
            sendResponse({
              ok: true,
              tab: null,
              state: { title: 'No Tab', url: '', elements: [], elementCount: 0 }
            });
            return;
          }

          const isInternal = !activeTab.url || activeTab.url.startsWith('chrome://') || activeTab.url.startsWith('chrome-extension://') || activeTab.url.startsWith('about:');

          if (isInternal) {
            sendResponse({
              ok: true,
              tab: activeTab,
              isInternal: true,
              state: {
                title: activeTab.title || 'New Tab',
                url: activeTab.url || 'chrome://newtab',
                elements: [],
                elementCount: 0,
                isInternal: true
              }
            });
            return;
          }

          await ensureContentScriptInjected(activeTab.id);

          try {
            chrome.tabs.sendMessage(activeTab.id, {
              action: 'SCAN_PAGE_STATE',
              showBadges: message.showBadges !== false
            }, { frameId: 0 }, (pageState) => {
              if (chrome.runtime.lastError) {
                const _ = chrome.runtime.lastError.message; // Clear unchecked error
                sendResponse({ ok: true, tab: activeTab, state: { title: activeTab.title || 'Webpage', url: activeTab.url || '', elements: [], elementCount: 0 } });
              } else {
                sendResponse({ ok: true, tab: activeTab, state: pageState || { elements: [], elementCount: 0 } });
              }
            });
          } catch (e) {
            sendResponse({ ok: true, tab: activeTab, state: { title: activeTab.title || 'Webpage', url: activeTab.url || '', elements: [], elementCount: 0 } });
          }
          break;
        }

        // --- 2. FULL BROWSER-LEVEL TOOL EXECUTION ---
        case 'EXECUTE_BROWSER_TOOL': {
          const { tool, url, tabId, query, zoomFactor, title } = message;
          const targetTab = await getTargetWebTab();
          const effectiveTabId = tabId || targetTab?.id;

          switch (tool) {
            case 'navigate': {
              const targetUrl = normalizeUrl(url);
              if (effectiveTabId) {
                await chrome.tabs.update(effectiveTabId, { url: targetUrl, active: true });
                await waitForTabComplete(effectiveTabId, 6000);
                sendResponse({ ok: true, tool: 'navigate', url: targetUrl, tabId: effectiveTabId });
              } else {
                const newTab = await chrome.tabs.create({ url: targetUrl, active: true });
                await waitForTabComplete(newTab.id, 6000);
                sendResponse({ ok: true, tool: 'navigate', url: targetUrl, tabId: newTab.id });
              }
              break;
            }

            case 'open_tab': {
              const targetUrl = normalizeUrl(url || 'https://www.google.com');
              const newTab = await chrome.tabs.create({ url: targetUrl, active: true });
              await waitForTabComplete(newTab.id, 6000);
              sendResponse({ ok: true, tool: 'open_tab', tabId: newTab.id, url: newTab.url });
              break;
            }

            case 'close_tab': {
              if (effectiveTabId) {
                await chrome.tabs.remove(effectiveTabId);
                sendResponse({ ok: true, tool: 'close_tab', tabId: effectiveTabId });
              } else {
                sendResponse({ ok: false, error: 'No tabId to close' });
              }
              break;
            }

            case 'switch_tab': {
              const allTabs = await chrome.tabs.query({});
              let matched = null;
              if (query) {
                const qLower = query.toLowerCase();
                matched = allTabs.find(t => (t.title && t.title.toLowerCase().includes(qLower)) || (t.url && t.url.toLowerCase().includes(qLower)));
              }
              if (!matched && tabId) {
                matched = allTabs.find(t => t.id === tabId);
              }
              if (matched) {
                await chrome.tabs.update(matched.id, { active: true });
                sendResponse({ ok: true, tool: 'switch_tab', tabId: matched.id, title: matched.title });
              } else {
                sendResponse({ ok: false, error: `Tab matching "${query}" not found` });
              }
              break;
            }

            case 'list_tabs': {
              const allTabs = await chrome.tabs.query({});
              const summary = allTabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.active }));
              sendResponse({ ok: true, tool: 'list_tabs', tabs: summary });
              break;
            }

            case 'go_back': {
              if (effectiveTabId) {
                await chrome.tabs.goBack(effectiveTabId);
                sendResponse({ ok: true, tool: 'go_back' });
              } else {
                sendResponse({ ok: false, error: 'No active tab' });
              }
              break;
            }

            case 'go_forward': {
              if (effectiveTabId) {
                await chrome.tabs.goForward(effectiveTabId);
                sendResponse({ ok: true, tool: 'go_forward' });
              } else {
                sendResponse({ ok: false, error: 'No active tab' });
              }
              break;
            }

            case 'reload': {
              if (effectiveTabId) {
                await chrome.tabs.reload(effectiveTabId);
                sendResponse({ ok: true, tool: 'reload' });
              } else {
                sendResponse({ ok: false, error: 'No active tab' });
              }
              break;
            }

            case 'zoom': {
              if (effectiveTabId) {
                const factor = parseFloat(zoomFactor) || 1.0;
                await chrome.tabs.setZoom(effectiveTabId, factor);
                sendResponse({ ok: true, tool: 'zoom', factor });
              } else {
                sendResponse({ ok: false, error: 'No active tab' });
              }
              break;
            }

            case 'bookmark': {
              if (chrome.bookmarks && targetTab) {
                const bm = await chrome.bookmarks.create({
                  title: title || targetTab.title || 'Bookmark',
                  url: url || targetTab.url
                });
                sendResponse({ ok: true, tool: 'bookmark', id: bm.id });
              } else {
                sendResponse({ ok: false, error: 'Bookmarks API unavailable' });
              }
              break;
            }

            case 'download': {
              if (chrome.downloads && url) {
                const dlId = await chrome.downloads.download({ url });
                sendResponse({ ok: true, tool: 'download', downloadId: dlId });
              } else {
                sendResponse({ ok: false, error: 'Download failed or no URL' });
              }
              break;
            }

            case 'screenshot': {
              if (targetTab) {
                const imgUrl = await chrome.tabs.captureVisibleTab(targetTab.windowId, { format: 'jpeg', quality: 80 });
                sendResponse({ ok: true, tool: 'screenshot', dataUrl: imgUrl });
              } else {
                sendResponse({ ok: false, error: 'No active tab to capture' });
              }
              break;
            }

            case 'inject_script':
            case 'execute_script': {
              const scriptCode = message.script || message.code || message.value || '';
              if (!scriptCode) {
                sendResponse({ ok: false, error: 'No script provided for inject_script' });
                break;
              }
              try {
                const scriptRes = await chrome.scripting.executeScript({
                  target: { tabId: effectiveTabId },
                  world: 'MAIN',
                  func: (code) => {
                    try {
                      const res = (0, eval)(code);
                      return { ok: true, result: res !== undefined ? String(res) : 'Executed successfully' };
                    } catch (e) {
                      return { ok: false, error: e.message };
                    }
                  },
                  args: [scriptCode]
                });
                const resObj = (scriptRes && scriptRes[0] && scriptRes[0].result) || { ok: true };
                sendResponse(resObj);
              } catch (err) {
                sendResponse({ ok: false, error: err.message });
              }
              break;
            }

            default:
              sendResponse({ ok: false, error: `Unknown browser tool: ${tool}` });
          }
          break;
        }

        // --- 3. PAGE DOM TOOL EXECUTION ---
        case 'EXECUTE_PAGE_TOOL': {
          const { tabId, tool, target, value, key, direction, url, x, y, durationMs, script } = message;
          const targetTab = await getTargetWebTab();
          const targetTabId = tabId || targetTab?.id;

          if (!targetTabId) {
            sendResponse({ ok: false, error: 'No active tab for action' });
            return;
          }

          // If on internal page and user wants navigate, redirect to browser tool
          if (targetTab.url && (targetTab.url.startsWith('chrome://') || targetTab.url.startsWith('chrome-extension://') || targetTab.url.startsWith('about:'))) {
            if (tool === 'navigate' || url) {
              const targetUrl = normalizeUrl(url || value);
              await chrome.tabs.update(targetTabId, { url: targetUrl });
              sendResponse({ ok: true, tool: 'navigate', url: targetUrl });
              return;
            }
            sendResponse({ ok: false, error: 'Cannot interact with elements on internal page. Navigate to a website first.' });
            return;
          }

          await ensureContentScriptInjected(targetTabId);

          chrome.tabs.sendMessage(targetTabId, {
            action: 'EXECUTE_TOOL',
            tool,
            target,
            value,
            key,
            direction,
            url,
            x,
            y,
            durationMs,
            script: script || value
          }, { frameId: 0 }, async (toolResult) => {
            if (chrome.runtime.lastError) {
              const _ = chrome.runtime.lastError.message; // Clear unchecked error
              // If page disconnected because it is already navigating to new URL, report success
              sendResponse({ ok: true, navigating: true });
              return;
            }

            // Elevated link navigation fallback: If tool is click and destination URL is known
            let navUrl = toolResult?.navigatedUrl || (url && /^https?:\/\//i.test(url) ? url : null);
            if (navUrl && (navUrl.includes('/url?') || navUrl.includes('url=http') || navUrl.includes('q=http'))) {
              try {
                const parsedNav = new URL(navUrl, 'https://www.google.com');
                const destParam = parsedNav.searchParams.get('url') || parsedNav.searchParams.get('q');
                if (destParam) {
                  const decodedDest = decodeURIComponent(destParam);
                  if (/^https?:\/\//i.test(decodedDest)) {
                    navUrl = decodedDest;
                  }
                }
              } catch (_) {}
            }

            if (tool === 'click' && navUrl && /^https?:\/\//i.test(navUrl)) {
              try {
                const currentTab = await chrome.tabs.get(targetTabId);
                const isSearchPage = currentTab && currentTab.url && (/google\.[a-z.]+\/search|youtube\.com\/results|bing\.com\/search|duckduckgo\.com\/\?q=/i.test(currentTab.url));
                const isAlreadyOnNavUrl = !isSearchPage && currentTab && currentTab.url && (
                  currentTab.url === navUrl ||
                  currentTab.url.split('#')[0] === navUrl.split('#')[0]
                );

                if (!isAlreadyOnNavUrl) {
                  console.log('[Gemma4:SW] Elevating link click navigation via chrome.tabs.update to:', navUrl);
                  await chrome.tabs.update(targetTabId, { url: navUrl, active: true });
                  await waitForTabComplete(targetTabId, 6000);
                  sendResponse({ ok: true, tool: 'click', navigatedUrl: navUrl });
                  return;
                }
              } catch (navErr) {
                console.warn('[Gemma4:SW] Navigation elevation failed:', navErr);
              }
            }

            // If CDP trusted hardware mode is enabled, dispatch hardware click/input
            if (self.cdpController && self.cdpController.enabled && message.useCdp !== false) {
              try {
                if (tool === 'click' && toolResult && toolResult.x !== undefined && toolResult.y !== undefined) {
                  await self.cdpController.clickAt(targetTabId, toolResult.x, toolResult.y);
                } else if (tool === 'press' && key) {
                  await self.cdpController.pressKey(targetTabId, key);
                }
              } catch (cdpErr) {
                console.warn('[Gemma4:SW] CDP hardware dispatch notice:', cdpErr.message);
              }
            }

            sendResponse(toolResult || { ok: true });
          });
          break;
        }

        case 'GET_AX_TREE': {
          const targetTab = await getTargetWebTab();
          const tId = message.tabId || targetTab?.id;
          if (self.cdpController && tId) {
            const nodes = await self.cdpController.getAccessibilityTree(tId);
            sendResponse({ ok: true, nodes: nodes || [] });
          } else {
            sendResponse({ ok: false, error: 'CDP not attached' });
          }
          break;
        }

        case 'TOGGLE_CDP': {
          if (self.cdpController) {
            self.cdpController.enabled = !!message.enabled;
            if (!self.cdpController.enabled) {
              await self.cdpController.detach();
            }
            sendResponse({ ok: true, enabled: self.cdpController.enabled });
          } else {
            sendResponse({ ok: false, enabled: false });
          }
          break;
        }

        case 'CLEAR_PAGE_BADGES': {
          let tab = null;
          if (message.tabId) {
            try {
              tab = await chrome.tabs.get(message.tabId);
            } catch (_) {}
          }
          if (!tab || !tab.id) {
            tab = await getTargetWebTab();
          }
          const isInternal = !tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:');
          if (tab && tab.id && !isInternal) {
            chrome.tabs.sendMessage(tab.id, { action: 'CLEAR_BADGES' }, { frameId: 0 }, () => {
              if (chrome.runtime.lastError) { const _ = chrome.runtime.lastError.message; }
            });
          }
          sendResponse({ ok: true });
          break;
        }

        default:
          sendResponse({ ok: false, error: 'Unknown action' });
      }
    } catch (err) {
      console.error('[Gemma4:SW] Error:', err);
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true; // Keep channel open for async response
});
