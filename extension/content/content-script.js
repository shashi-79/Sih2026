/**
 * Content Script: Gemma 4 Autonomous Browser Controller
 * Injects Set-of-Marks (SoM) badges onto interactive elements, extracts clean DOM context,
 * and executes Playwright-level actions (click, fill, press, scroll, navigate, extract).
 */

(function () {
  if (window.__gemma_agent_injected__) {
    return;
  }
  window.__gemma_agent_injected__ = true;

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
   * Checks if an element is renderable and not hidden via CSS
   */
  function isElementInteractable(el, doc = document) {
    if (!el) return false;
    const win = doc.defaultView || window;
    try {
      const style = win.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
      }
    } catch (_) { }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) return false;
    return true;
  }

  /**
   * Checks if an element is in visible viewport
   */
  function isElementInViewport(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const winHeight = window.innerHeight || document.documentElement.clientHeight;
    const winWidth = window.innerWidth || document.documentElement.clientWidth;
    return (
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= winHeight &&
      rect.left <= winWidth
    );
  }

  /**
   * Extracts clean descriptive label for any DOM element including associated labels
   */
  function extractElementText(node) {
    if (!node) return '';

    // 1. Check associated label by ID (e.g. <label for="myId">)
    if (node.id) {
      try {
        const lbl = document.querySelector(`label[for="${CSS.escape(node.id)}"]`);
        if (lbl && lbl.innerText && lbl.innerText.trim()) {
          return lbl.innerText.replace(/\s+/g, ' ').trim().substring(0, 70);
        }
      } catch (_) {}
    }

    // 2. Check enclosing parent label (e.g. <label>Email: <input></label>)
    const parentLabel = node.closest ? node.closest('label') : null;
    if (parentLabel && parentLabel.innerText && parentLabel.innerText.trim()) {
      return parentLabel.innerText.replace(/\s+/g, ' ').trim().substring(0, 70);
    }

    // 3. Check aria-labelledby
    const labelledBy = node.getAttribute ? node.getAttribute('aria-labelledby') : null;
    if (labelledBy) {
      try {
        const refEl = document.getElementById(labelledBy);
        if (refEl && refEl.innerText && refEl.innerText.trim()) {
          return refEl.innerText.replace(/\s+/g, ' ').trim().substring(0, 70);
        }
      } catch (_) {}
    }

    let text = node.innerText || '';
    if (!text.trim()) {
      text = node.getAttribute('aria-label') || '';
    }
    if (!text.trim()) {
      text = node.getAttribute('placeholder') || '';
    }
    if (!text.trim()) {
      text = node.getAttribute('title') || '';
    }
    if (!text.trim() && (node.tagName.toLowerCase() === 'input' || node.tagName.toLowerCase() === 'textarea')) {
      text = node.value || node.name || '';
    }
    if (!text.trim()) {
      const img = node.querySelector('img');
      if (img) text = img.getAttribute('alt') || img.getAttribute('title') || '';
    }
    if (!text.trim()) {
      text = node.getAttribute('name') || '';
    }

    // Fallback: check preceding sibling prompt for text input
    if (!text.trim() && (node.tagName.toLowerCase() === 'input' || node.tagName.toLowerCase() === 'textarea')) {
      const prev = node.previousElementSibling;
      if (prev && prev.innerText && prev.innerText.trim().length < 40) {
        text = prev.innerText.trim();
      }
    }

    return text.replace(/\s+/g, ' ').trim().substring(0, 70);
  }

  /**
   * Scans interactive elements across the document, prioritizing visible viewport elements
   */
  function scanInteractiveElements(options = { showBadges: true }) {
    clearBadges();
    elementRegistry.clear();

    const selectors = [
      'a[href]',
      'area[href]',
      'button:not([disabled])',
      'input:not([type="hidden"]):not([disabled])',
      'textarea:not([disabled])',
      'select:not([disabled])',
      'summary',
      '[role="button"]',
      '[role="link"]',
      '[role="searchbox"]',
      '[role="checkbox"]',
      '[role="tab"]',
      '[role="menuitem"]',
      '[role="option"]',
      '[role="switch"]',
      '[role="combobox"]',
      '[role="textbox"]',
      '[contenteditable="true"]',
      '[tabindex="0"]',
      '[onclick]',
      '[jsaction]'
    ].join(', ');

    // Collect elements from document and open shadow roots
    const nodes = [];
    const queue = [document];
    const visited = new Set();

    while (queue.length > 0) {
      const root = queue.shift();
      if (!root || visited.has(root)) continue;
      visited.add(root);

      try {
        const matches = root.querySelectorAll(selectors);
        for (let i = 0; i < matches.length; i++) {
          nodes.push(matches[i]);
        }
      } catch (_) { }

      try {
        const all = root.querySelectorAll('*');
        for (let i = 0; i < all.length; i++) {
          if (all[i].shadowRoot) {
            queue.push(all[i].shadowRoot);
          }
        }
      } catch (_) { }
    }

    // Filter valid interactive elements
    const validNodes = [];
    for (const node of nodes) {
      if (isElementInteractable(node)) {
        validNodes.push({
          node,
          inView: isElementInViewport(node)
        });
      }
    }

    // Sort: elements in viewport first, then document order
    validNodes.sort((a, b) => {
      if (a.inView && !b.inView) return -1;
      if (!a.inView && b.inView) return 1;
      return 0;
    });

    const container = options.showBadges ? ensureBadgeContainer() : null;
    const elements = [];
    let badgeIndex = 1;

    for (const item of validNodes) {
      const node = item.node;
      const inView = item.inView;
      const rect = node.getBoundingClientRect();
      const tagName = node.tagName.toLowerCase();
      const type = node.getAttribute('type') || '';
      const cleanText = extractElementText(node);
      const anchorNode = tagName === 'a' ? node : (node.closest('a') || node.querySelector('a'));
      let href = (anchorNode ? (anchorNode.getAttribute('href') || anchorNode.href || '') : (node.getAttribute('href') || node.href || '')).toString();
      if (href.includes('/url?') || href.includes('url=http')) {
        try {
          const parsedU = new URL(href, window.location.href);
          const qParam = parsedU.searchParams.get('q') || parsedU.searchParams.get('url');
          if (qParam && /^https?:\/\//i.test(qParam)) {
            href = qParam;
          }
        } catch (_) {}
      }

      const elementId = `agent_${badgeIndex}`;
      node.setAttribute('data-gemma-badge', badgeIndex);
      node.setAttribute('data-gemma-id', elementId);
      elementRegistry.set(badgeIndex, node);
      elementRegistry.set(badgeIndex.toString(), node);
      elementRegistry.set(elementId, node);

      // Render Set-of-Marks visual badge overlay for in-viewport elements
      if (options.showBadges && container && inView && badgeIndex <= 50) {
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
        href: href || '',
        inViewport: inView,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height)
        }
      });

      badgeIndex++;
      if (badgeIndex > 100) break; // Allow up to 100 elements across the page
    }

    return elements;
  }

  /**
   * Resolves target element from badge number, element ID, CSS selector, or fuzzy text
   */
  function resolveTarget(targetIdentifier, targetUrlHint = null) {
    if (!targetIdentifier && targetIdentifier !== 0 && !targetUrlHint) return null;

    // Handle object if passed { target: 1 } or { badge: 1 }
    if (typeof targetIdentifier === 'object' && targetIdentifier !== null) {
      targetIdentifier = targetIdentifier.badge || targetIdentifier.target || targetIdentifier.id || targetIdentifier.selector;
    }

    const isConnectedEl = (el) => el && (el.isConnected !== false) && (typeof document.contains === 'function' ? document.contains(el) : true);

    // 1. Direct registry lookup by exact key and string
    if (elementRegistry.has(targetIdentifier)) {
      const candidate = elementRegistry.get(targetIdentifier);
      if (isConnectedEl(candidate)) return candidate;
    }
    if (elementRegistry.has(String(targetIdentifier))) {
      const candidate = elementRegistry.get(String(targetIdentifier));
      if (isConnectedEl(candidate)) return candidate;
    }

    // 2. Extract numeric digits (handles "[1]", "#1", "badge 1", "agent_1")
    const digitsMatch = targetIdentifier !== undefined && targetIdentifier !== null ? String(targetIdentifier).match(/\d+/) : null;
    if (digitsMatch) {
      const num = parseInt(digitsMatch[0], 10);
      if (elementRegistry.has(num)) {
        const candidate = elementRegistry.get(num);
        if (isConnectedEl(candidate)) return candidate;
      }
      if (elementRegistry.has(String(num))) {
        const candidate = elementRegistry.get(String(num));
        if (isConnectedEl(candidate)) return candidate;
      }
      const byBadgeAttr = document.querySelector(`[data-gemma-badge="${num}"]`);
      if (isConnectedEl(byBadgeAttr)) return byBadgeAttr;
      const byAgentId = document.querySelector(`[data-gemma-id="agent_${num}"]`);
      if (isConnectedEl(byAgentId)) return byAgentId;
    }

    // 3. Lookup by data-gemma-id
    if (targetIdentifier) {
      const byId = document.querySelector(`[data-gemma-id="${targetIdentifier}"]`);
      if (isConnectedEl(byId)) return byId;
    }

    // 4. Fallback lookup by target URL hint (essential for search results & links)
    if (typeof targetUrlHint === 'string' && /^https?:\/\//i.test(targetUrlHint)) {
      try {
        const u = new URL(targetUrlHint);
        const host = u.hostname.replace(/^www\./, '').toLowerCase();
        const path = u.pathname.length > 2 ? u.pathname.toLowerCase() : '';
        const links = Array.from(document.querySelectorAll('a[href]'));

        // 4a. Exact or prefix href match
        for (const a of links) {
          const aHref = (a.getAttribute('href') || a.href || '').toString();
          if (aHref === targetUrlHint || aHref.startsWith(targetUrlHint)) {
            if (isConnectedEl(a)) return a;
          }
        }

        // 4b. Hostname + pathname match (handles query param variances)
        for (const a of links) {
          const aHref = (a.getAttribute('href') || a.href || '').toString().toLowerCase();
          if (aHref.includes(host) && (!path || aHref.includes(path))) {
            if (isConnectedEl(a)) return a;
          }
        }
      } catch (_) {}
    }

    // 5. Safe CSS selector fallback (skip if bracketed number)
    try {
      if (typeof targetIdentifier === 'string' && !/^\[\d+\]$/.test(targetIdentifier.trim())) {
        const bySelector = document.querySelector(targetIdentifier);
        if (isConnectedEl(bySelector)) return bySelector;
      }
    } catch (_) { }

    // 6. Semantic text search across all interactive elements (fuzzy match)
    if (typeof targetIdentifier === 'string' && targetIdentifier.length > 1) {
      const lower = targetIdentifier.trim().toLowerCase();
      const candidates = Array.from(document.querySelectorAll('a, button, input, textarea, select, [role="button"], [role="link"], [role="tab"], [role="searchbox"], [role="textbox"]'));

      // 6a. Exact text match
      for (const el of candidates) {
        const txt = extractElementText(el).toLowerCase();
        if (txt === lower && isConnectedEl(el)) return el;
      }

      // 6b. Substring match on text, aria-label, placeholder
      for (const el of candidates) {
        const txt = extractElementText(el).toLowerCase();
        if (txt && txt.includes(lower) && isConnectedEl(el)) return el;
        const ph = (el.getAttribute('placeholder') || '').toLowerCase();
        if (ph && ph.includes(lower) && isConnectedEl(el)) return el;
      }

      // 6c. Match in href (e.g. target is "login" and link href has "/login")
      for (const el of candidates) {
        const href = (el.getAttribute('href') || '').toLowerCase();
        if (href && href.includes(lower) && isConnectedEl(el)) return el;
      }

      // 6d. Ordinal lookup: "first link", "first result", "second link"
      if (/first|1st/i.test(lower)) {
        const firstLink = candidates.find(c => c.tagName.toLowerCase() === 'a' && extractElementText(c).length > 2 && isConnectedEl(c));
        if (firstLink) return firstLink;
      }
      if (/second|2nd/i.test(lower)) {
        const links = candidates.filter(c => c.tagName.toLowerCase() === 'a' && extractElementText(c).length > 2 && isConnectedEl(c));
        if (links[1]) return links[1];
      }
    }

    return null;
  }

  /**
   * Extracts clean, readable text from page or target element
   */
  function extractCleanPageContent(targetEl = null) {
    let sourceNode = targetEl;

    if (!sourceNode) {
      // Prioritize semantic content containers
      sourceNode = document.querySelector('article, main, [role="main"], #content, .article-content, .post-content, .entry-content, .mw-parser-output');
    }
    if (!sourceNode) {
      sourceNode = document.body;
    }
    if (!sourceNode) {
      return { ok: false, text: '', wordCount: 0 };
    }

    let text = '';
    try {
      const clone = sourceNode.cloneNode(true);
      const toRemove = clone.querySelectorAll('script, style, noscript, nav, header, footer, svg, button, iframe, [aria-hidden="true"], .__gemma_badge_container__');
      for (let i = 0; i < toRemove.length; i++) {
        toRemove[i].remove();
      }
      text = clone.innerText || clone.textContent || '';
    } catch (_) {
      text = sourceNode.innerText || sourceNode.textContent || '';
    }

    // Clean whitespace and limit to 4000 characters
    const clean = text
      .replace(/[\r\n]+/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .trim()
      .substring(0, 4000);

    const words = clean ? clean.split(/\s+/).length : 0;
    return {
      ok: true,
      title: document.title || '',
      url: window.location.href,
      text: clean,
      wordCount: words
    };
  }

  /**
   * Message Router for Extension Orchestrator
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.action) {
      sendResponse({ ok: false, error: 'Empty message' });
      return false;
    }

    // Sub-frames safely report frame status without failing
    if (!isTopFrame && message.action === 'SCAN_PAGE_STATE') {
      sendResponse({ ok: true, isTopFrame: false, elements: [] });
      return false;
    }

    (async () => {
      try {
        switch (message.action) {
          case 'SCAN_PAGE_STATE': {
            const elements = scanInteractiveElements({ showBadges: message.showBadges !== false });
            const pageTitle = document.title || '';
            const pageUrl = window.location.href;
            const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
              .map(h => (h.innerText || '').replace(/\s+/g, ' ').trim())
              .filter(t => t.length > 2)
              .slice(0, 6);
            const alerts = Array.from(document.querySelectorAll('[role="alert"], .alert, .error, .toast, .notice'))
              .map(a => (a.innerText || '').replace(/\s+/g, ' ').trim())
              .filter(t => t.length > 2)
              .slice(0, 3);

            sendResponse({
              ok: true,
              frameId: frameIdentifier,
              isTopFrame,
              title: pageTitle,
              url: pageUrl,
              elementCount: elements.length,
              elements,
              headings,
              alerts
            });
            break;
          }

          case 'CLEAR_BADGES': {
            clearBadges();
            sendResponse({ ok: true });
            break;
          }

          case 'EXTRACT_PAGE_CONTENT': {
            const mainText = (document.body ? document.body.innerText : '').substring(0, 3000);
            sendResponse({
              ok: true,
              title: document.title,
              url: window.location.href,
              text: mainText
            });
            break;
          }

          case 'EXECUTE_TOOL': {
            let { tool, target, value, key, direction, url } = message;

            // Normalize tool aliases
            if (tool === 'type' || tool === 'write' || tool === 'input') tool = 'fill';
            if (tool === 'enter' || tool === 'keypress') tool = 'press';
            if (tool === 'read' || tool === 'read_article' || tool === 'extract_text' || tool === 'readpage') tool = 'read_page';
            if (tool === 'mouse_move' || tool === 'mousemove' || tool === 'cursor_move' || tool === 'move_cursor' || tool === 'pointer_move') tool = 'move_mouse';
            if (tool === 'mouse_hover' || tool === 'mousehover') tool = 'hover';
            if (tool === 'execute_script' || tool === 'run_script' || tool === 'eval_script' || tool === 'eval' || tool === 'script') tool = 'inject_script';

            let el = resolveTarget(target, url);

            // Check if el is an actual fillable text input/textarea/editable
            const inputType = el && el.tagName === 'INPUT' ? (el.getAttribute('type') || 'text').toLowerCase() : '';
            const nonTextInputTypes = ['submit', 'button', 'reset', 'checkbox', 'radio', 'hidden', 'file', 'image'];
            const isFillable = el && (
              (el.tagName === 'INPUT' && !nonTextInputTypes.includes(inputType)) ||
              el.tagName === 'TEXTAREA' ||
              el.isContentEditable ||
              el.getAttribute('contenteditable') === 'true' ||
              el.getAttribute('role') === 'textbox' ||
              el.getAttribute('role') === 'searchbox'
            );

            // Smart fallback for fill/clear: If target element not found, not fillable, or on search home, find search box
            if (tool === 'fill' || tool === 'clear') {
              const isSearchEngineHome = (/google\./i.test(window.location.hostname) && !window.location.pathname.startsWith('/search')) ||
                                         (/youtube\./i.test(window.location.hostname) && !window.location.pathname.startsWith('/results'));
              if (!el || !isFillable || isSearchEngineHome) {
                if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.isContentEditable)) {
                  el = document.activeElement;
                }
                if (!el || !isFillable) {
                  const primaryInput = document.querySelector('textarea[name="q"], input[name="q"], input[name="search_query"], input[type="search"], textarea[name*="search" i], input[placeholder*="search" i], input[aria-label*="search" i], [role="searchbox"], [role="textbox"], textarea, input:not([type="hidden"]):not([type="submit"]):not([type="button"])');
                  if (primaryInput) {
                    el = primaryInput;
                  }
                }
              }
            }

            if (!el && (tool === 'click' || tool === 'fill' || tool === 'hover' || tool === 'clear' || tool === 'select_option' || tool === 'check' || tool === 'uncheck' || (tool === 'move_mouse' && (message.x === undefined || message.y === undefined)))) {
              sendResponse({ ok: false, error: `Target element '${target}' not found on page` });
              return;
            }

            let result = null;
            if (tool === 'click') {
              result = await window.PlaywrightDriver.click(el);
            } else if (tool === 'hover') {
              result = await window.PlaywrightDriver.hover(el);
            } else if (tool === 'move_mouse') {
              if (el) {
                result = await window.PlaywrightDriver.moveToElement(el, message.durationMs || 260);
              } else if (message.x !== undefined && message.y !== undefined) {
                result = await window.PlaywrightDriver.moveMouse(Number(message.x), Number(message.y), message.durationMs || 260);
              }
            } else if (tool === 'fill') {
              const textVal = value !== undefined && value !== null ? String(value) : '';
              result = await window.PlaywrightDriver.fill(el, textVal);

              // Automatically trigger Enter if explicitly requested OR if target is a search input
              const isSearchInput = el && (
                el.getAttribute('type') === 'search' ||
                el.getAttribute('name') === 'q' ||
                el.getAttribute('name') === 'search_query' ||
                el.getAttribute('role') === 'searchbox' ||
                /search/i.test(el.getAttribute('placeholder') || '') ||
                /search/i.test(el.getAttribute('aria-label') || '')
              );

              if (key === 'Enter' || (!key && isSearchInput)) {
                await window.PlaywrightDriver.press(el, 'Enter');

                // Direct search engine navigation fallback
                if (textVal && /google\./i.test(window.location.hostname) && !window.location.pathname.startsWith('/search')) {
                  window.location.href = `https://www.google.com/search?q=${encodeURIComponent(textVal)}`;
                } else if (textVal && /youtube\./i.test(window.location.hostname) && !window.location.pathname.startsWith('/results')) {
                  window.location.href = `https://www.youtube.com/results?search_query=${encodeURIComponent(textVal)}`;
                }
              }
            } else if (tool === 'clear') {
              result = await window.PlaywrightDriver.clear(el);
            } else if (tool === 'select_option') {
              result = await window.PlaywrightDriver.selectOption(el, value || '');
            } else if (tool === 'check') {
              result = await window.PlaywrightDriver.setChecked(el, true);
            } else if (tool === 'uncheck') {
              result = await window.PlaywrightDriver.setChecked(el, false);
            } else if (tool === 'press') {
              result = await window.PlaywrightDriver.press(el, key || 'Enter');
            } else if (tool === 'scroll') {
              const scrollAmt = message.amount || (direction === 'top' || direction === 'bottom' ? 999999 : 500);
              result = await window.PlaywrightDriver.scroll(direction || 'down', scrollAmt);
            } else if (tool === 'navigate') {
              if (url) {
                window.location.href = url;
                result = { ok: true, navigatedTo: url };
              }
            } else if (tool === 'read_page') {
              result = extractCleanPageContent(el);
            } else if (tool === 'extract_text') {
              result = extractCleanPageContent(el);
            } else if (tool === 'inject_script') {
              const scriptCode = message.script || message.code || value || '';
              result = await window.PlaywrightDriver.injectScript(scriptCode);
            } else {
              throw new Error(`Unsupported tool: ${tool}`);
            }

            const cleanNavUrl = result?.navigatedUrl || (el && (el.tagName && el.tagName.toLowerCase() === 'a' ? el.href : (el.closest && el.closest('a') ? el.closest('a').href : null))) || null;
            sendResponse({ ok: true, tool, target, result, navigatedUrl: cleanNavUrl });
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
