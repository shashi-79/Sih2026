/**
 * Content Script: Gemma 4 Autonomous Browser Controller
 * Injects Set-of-Marks (SoM) badges onto interactive elements, extracts clean DOM context,
 * and executes Playwright-level actions (click, fill, press, scroll, navigate, extract).
 */

(function () {
  const isTopFrame = window === window.top;
  const frameIdentifier = isTopFrame ? 'top' : (window.name || `frame_${Math.random().toString(36).substring(2, 7)}`);

  let elementRegistry = new Map(); // badgeIndex -> HTMLElement
  let badgeContainer = null;
  let activeBadges = [];

  console.log(`[Gemma4:ContentScript] Initialized in ${isTopFrame ? 'Top-Level Frame' : 'Sub-Frame (' + window.location.href + ')'}`);

  /**
   * Ensures the badge container overlay exists in DOM
   */
  function ensureBadgeContainer() {
    if (!badgeContainer || !document.body.contains(badgeContainer)) {
      badgeContainer = document.createElement('div');
      badgeContainer.id = '__gemma_agent_badges__';
      badgeContainer.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 2147483647;
      `;
      document.body.appendChild(badgeContainer);
    }
    return badgeContainer;
  }

  /**
   * Removes all visible badges from the page
   */
  function clearBadges() {
    if (badgeContainer && badgeContainer.parentNode) {
      badgeContainer.innerHTML = '';
    }
    activeBadges = [];
  }

  /**
   * Checks if an element is currently visible in viewport
   */
  function isElementVisible(el, doc = document) {
    if (!el) return false;
    const win = doc.defaultView || window;
    const style = win.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    return (
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= (win.innerHeight || doc.documentElement.clientHeight) &&
      rect.left <= (win.innerWidth || doc.documentElement.clientWidth)
    );
  }

  /**
   * Scans interactive elements, assigns Set-of-Marks badges, and builds structured element map for Gemma 4
   */
  function scanInteractiveElements(options = { showBadges: true }) {
    clearBadges();
    elementRegistry.clear();

    const selectors = [
      'button:not([disabled])',
      'input:not([type="hidden"]):not([disabled])',
      'textarea:not([disabled])',
      'select:not([disabled])',
      'a[href]',
      '[role="button"]',
      '[role="link"]',
      '[role="searchbox"]',
      '[role="checkbox"]',
      '[role="tab"]',
      '[tabindex="0"]'
    ].join(', ');

    let nodes = [];
    try {
      nodes = Array.from(document.querySelectorAll(selectors));
    } catch (e) {
      return [];
    }

    const container = options.showBadges ? ensureBadgeContainer() : null;
    const elements = [];
    let badgeIndex = 1;

    for (const node of nodes) {
      if (!isElementVisible(node)) continue;

      const rect = node.getBoundingClientRect();
      const tagName = node.tagName.toLowerCase();
      const type = node.getAttribute('type') || '';
      const text = (node.innerText || node.getAttribute('aria-label') || node.getAttribute('placeholder') || node.getAttribute('title') || node.value || '').trim();
      const cleanText = text.replace(/\s+/g, ' ').substring(0, 50);

      const elementId = `agent_${badgeIndex}`;
      node.setAttribute('data-gemma-badge', badgeIndex);
      node.setAttribute('data-gemma-id', elementId);
      elementRegistry.set(badgeIndex, node);
      elementRegistry.set(badgeIndex.toString(), node);
      elementRegistry.set(elementId, node);

      // Render Set-of-Marks visual badge overlay
      if (options.showBadges && container) {
        const badge = document.createElement('div');
        badge.className = '__gemma_badge_item__';
        const scrollX = window.scrollX || window.pageXOffset;
        const scrollY = window.scrollY || window.pageYOffset;

        badge.style.cssText = `
          position: absolute;
          left: ${rect.left + scrollX}px;
          top: ${Math.max(0, rect.top + scrollY - 14)}px;
          background: linear-gradient(135deg, #4f46e5, #06b6d4);
          color: #ffffff;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 11px;
          font-weight: 700;
          line-height: 1;
          padding: 2px 5px;
          border-radius: 4px;
          border: 1px solid rgba(255, 255, 255, 0.8);
          box-shadow: 0 2px 5px rgba(0,0,0,0.4);
          pointer-events: none;
          z-index: 2147483647;
          opacity: 0.95;
        `;
        badge.textContent = `[${badgeIndex}]`;
        container.appendChild(badge);
        activeBadges.push(badge);
      }

      elements.push({
        badge: badgeIndex,
        id: elementId,
        tag: tagName,
        type: type,
        text: cleanText,
        placeholder: node.getAttribute('placeholder') || '',
        role: node.getAttribute('role') || tagName,
        href: node.getAttribute('href') || '',
        value: (node.value || '').substring(0, 30),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height)
        }
      });

      badgeIndex++;
      if (badgeIndex > 40) break; // Limit to top 40 most relevant elements in viewport
    }

    return elements;
  }

  /**
   * Resolves target element from badge number, element ID, or CSS selector
   */
  function resolveTarget(targetIdentifier) {
    if (!targetIdentifier) return null;

    // 1. Direct registry lookup by badge number or ID
    if (elementRegistry.has(targetIdentifier)) {
      return elementRegistry.get(targetIdentifier);
    }

    // 2. Lookup by numeric badge attribute
    const num = parseInt(targetIdentifier, 10);
    if (!isNaN(num)) {
      const byBadgeAttr = document.querySelector(`[data-gemma-badge="${num}"]`);
      if (byBadgeAttr) return byBadgeAttr;
    }

    // 3. Lookup by data-gemma-id
    const byId = document.querySelector(`[data-gemma-id="${targetIdentifier}"]`);
    if (byId) return byId;

    // 4. CSS selector fallback
    try {
      const bySelector = document.querySelector(targetIdentifier);
      if (bySelector) return bySelector;
    } catch (_) {}

    // 5. Semantic text search fallback (fuzzy match text or aria-label)
    if (typeof targetIdentifier === 'string' && targetIdentifier.length > 2) {
      const allButtons = Array.from(document.querySelectorAll('button, a, input[type="submit"], [role="button"]'));
      const lower = targetIdentifier.toLowerCase();
      for (const btn of allButtons) {
        const txt = (btn.innerText || btn.getAttribute('aria-label') || '').toLowerCase();
        if (txt.includes(lower)) return btn;
      }
    }

    return null;
  }

  /**
   * Message Router for Extension Orchestrator
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.action) return false;

    (async () => {
      try {
        switch (message.action) {
          case 'SCAN_PAGE_STATE': {
            const elements = scanInteractiveElements({ showBadges: message.showBadges !== false });
            const pageTitle = document.title || '';
            const pageUrl = window.location.href;

            sendResponse({
              ok: true,
              frameId: frameIdentifier,
              isTopFrame,
              title: pageTitle,
              url: pageUrl,
              elementCount: elements.length,
              elements
            });
            break;
          }

          case 'CLEAR_BADGES': {
            clearBadges();
            sendResponse({ ok: true });
            break;
          }

          case 'EXTRACT_PAGE_CONTENT': {
            const mainText = (document.body.innerText || '').substring(0, 3000);
            sendResponse({
              ok: true,
              title: document.title,
              url: window.location.href,
              text: mainText
            });
            break;
          }

          case 'EXECUTE_TOOL': {
            const { tool, target, value, key, direction, url } = message;
            const el = resolveTarget(target);

            if (!el && (tool === 'click' || tool === 'fill' || tool === 'hover')) {
              sendResponse({ ok: false, error: `Target element '${target}' not found on page` });
              return;
            }

            let result = null;
            if (tool === 'click') {
              result = await window.PlaywrightDriver.click(el);
            } else if (tool === 'fill') {
              result = await window.PlaywrightDriver.fill(el, value || '');
            } else if (tool === 'press') {
              result = await window.PlaywrightDriver.press(el, key || 'Enter');
            } else if (tool === 'scroll') {
              result = await window.PlaywrightDriver.scroll(direction || 'down', 400);
            } else if (tool === 'navigate') {
              if (url) {
                window.location.href = url;
                result = { ok: true, navigatedTo: url };
              }
            } else if (tool === 'extract_text') {
              const extracted = el ? (el.innerText || el.value) : (document.body.innerText || '').substring(0, 1500);
              result = { ok: true, text: extracted };
            } else {
              throw new Error(`Unsupported tool: ${tool}`);
            }

            sendResponse({ ok: true, tool, target, result });
            break;
          }

          default:
            sendResponse({ ok: false, error: 'Unknown action' });
        }
      } catch (err) {
        console.error('[Gemma4:ContentScript] Tool execution error:', err);
        sendResponse({ ok: false, error: err.message });
      }
    })();

    return true; // Keep message channel open for async response
  });
})();
