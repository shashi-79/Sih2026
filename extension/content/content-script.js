/**
 * Content Script: Micro-Element Slicer, Multi-Layer Iframe Traverser,
 * and PII Detection Scanner.
 */

(function () {
  const isTopFrame = window === window.top;
  const frameIdentifier = isTopFrame ? 'top' : `frame_${Math.random().toString(36).substring(2, 8)}`;
  
  let elementRegistry = new Map(); // id -> HTMLElement
  let elementCounter = 0;

  console.log(`[VisionAgent:ContentScript] Initialized in ${isTopFrame ? 'Top-Level Frame' : 'Sub-Frame (' + window.location.href + ')'}`);

  // Regex patterns for sensitive DOM PII detection
  const PII_PATTERNS = {
    creditCard: /\b(?:\d[ -]*?){13,16}\b/,
    email: /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/,
    phone: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/,
    ssn: /\b\d{3}-\d{2}-\d{4}\b/
  };

  /**
   * Scans visible interactive elements and compresses them into micro-tuples
   * for the Needle2 256-token sliding window
   */
  function scanInteractiveElements() {
    elementRegistry.clear();
    elementCounter = 0;

    const interactiveSelectors = [
      'button:not([disabled])',
      'input:not([type="hidden"]):not([disabled])',
      'textarea:not([disabled])',
      'select:not([disabled])',
      'a[href]',
      '[role="button"]',
      '[role="link"]',
      '[role="checkbox"]',
      '[tabindex="0"]'
    ].join(', ');

    const nodes = Array.from(document.querySelectorAll(interactiveSelectors));
    const microElements = [];

    for (const node of nodes) {
      if (!isElementVisible(node)) continue;

      elementCounter++;
      const assignedId = `${frameIdentifier}_${elementCounter}`;
      node.setAttribute('data-sih-id', assignedId);
      elementRegistry.set(assignedId, node);

      const rect = node.getBoundingClientRect();
      const tagName = node.tagName.toLowerCase();
      const type = node.getAttribute('type') || '';
      const text = (node.innerText || node.getAttribute('aria-label') || node.getAttribute('placeholder') || node.value || '').trim();
      const truncatedText = text.substring(0, 24);

      // Micro-tuple: compact representation to save prompt tokens
      microElements.push({
        id: assignedId,
        tag: tagName,
        type: type,
        text: truncatedText,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height)
        },
        isIframe: !isTopFrame
      });

      if (microElements.length >= 12) break; // Limit candidate pool for sliding window
    }

    return microElements;
  }

  /**
   * Scans for sensitive PII in DOM: password inputs, credit cards, emails, tokens
   * Returns exact pixel bounding rectangles for the OpenCV visual redactor
   */
  function scanPIIBoundingBoxes() {
    const sensitiveRects = [];

    // 1. Structural password inputs
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    passwordInputs.forEach(el => {
      if (isElementVisible(el)) {
        const r = el.getBoundingClientRect();
        sensitiveRects.push({
          type: 'password_field',
          rect: { x: r.x, y: r.y, w: r.width, h: r.height }
        });
      }
    });

    // 2. Scan text nodes & values against PII regexes
    const allInputs = document.querySelectorAll('input:not([type="password"]), textarea');
    allInputs.forEach(input => {
      const val = input.value || '';
      const nameAttr = (input.name || input.id || input.placeholder || '').toLowerCase();
      
      const isSensitiveName = /card|cvv|cvc|ssn|pass|token|secret|pin|auth/.test(nameAttr);
      const isSensitiveValue = PII_PATTERNS.creditCard.test(val) || PII_PATTERNS.email.test(val) || PII_PATTERNS.ssn.test(val);

      if (isSensitiveName || isSensitiveValue) {
        if (isElementVisible(input)) {
          const r = input.getBoundingClientRect();
          sensitiveRects.push({
            type: 'pii_input',
            rect: { x: r.x, y: r.y, w: r.width, h: r.height }
          });
        }
      }
    });

    // 3. Scan rendered text elements for sensitive labels
    const textElements = document.querySelectorAll('p, span, div, h1, h2, h3, td, th');
    textElements.forEach(el => {
      if (el.children.length === 0 && el.innerText) {
        const txt = el.innerText.trim();
        if (PII_PATTERNS.creditCard.test(txt) || PII_PATTERNS.ssn.test(txt)) {
          if (isElementVisible(el)) {
            const r = el.getBoundingClientRect();
            sensitiveRects.push({
              type: 'pii_text',
              rect: { x: r.x, y: r.y, w: r.width, h: r.height }
            });
          }
        }
      }
    });

    return sensitiveRects;
  }

  function isElementVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    // Check within viewport
    return (
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.left <= (window.innerWidth || document.documentElement.clientWidth)
    );
  }

  /**
   * Listen for commands dispatched from Background Service Worker
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.action) return false;

    (async () => {
      try {
        switch (message.action) {
          case 'GENERATE_FALLBACK_SCREENSHOT': {
            const canvas = document.createElement('canvas');
            canvas.width = window.innerWidth || 1280;
            canvas.height = window.innerHeight || 800;
            const ctx = canvas.getContext('2d');

            // Draw base background
            ctx.fillStyle = '#0b0f19';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Draw all visible block elements
            const allNodes = document.querySelectorAll('div, section, header, button, input, p, h1, h2, h3, canvas');
            for (const el of allNodes) {
              if (el === canvas) continue;
              const r = el.getBoundingClientRect();
              if (r.width > 0 && r.height > 0 && r.bottom >= 0 && r.top <= canvas.height) {
                const style = window.getComputedStyle(el);
                if (style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)') {
                  ctx.fillStyle = style.backgroundColor;
                  ctx.fillRect(r.x, r.y, r.width, r.height);
                }
                // If it's a canvas (e.g. face avatar), draw its content
                if (el.tagName.toLowerCase() === 'canvas') {
                  try { ctx.drawImage(el, r.x, r.y, r.width, r.height); } catch (e) {}
                }
                // If it has text, render text
                if (el.children.length === 0 && (el.innerText || el.value)) {
                  ctx.fillStyle = style.color || '#e2e8f0';
                  ctx.font = `${style.fontSize || '12px'} ${style.fontFamily || 'sans-serif'}`;
                  const txt = (el.value || el.innerText || '').substring(0, 40);
                  ctx.fillText(txt, r.x + 4, r.y + r.height / 2 + 4);
                }
              }
            }

            const dataUrl = canvas.toDataURL('image/png');
            sendResponse({ ok: true, dataUrl });
            break;
          }

          case 'SCAN_VIEWPORT': {
            const elements = scanInteractiveElements();
            const pii = scanPIIBoundingBoxes();
            sendResponse({
              ok: true,
              frame: frameIdentifier,
              isTop: isTopFrame,
              elements,
              piiRects: pii,
              url: window.location.href
            });
            break;
          }

          case 'EXECUTE_TOOL': {
            const { tool, id, value, key, direction } = message;
            const target = elementRegistry.get(id) || document.querySelector(`[data-sih-id="${id}"]`);

            if (!target && (tool === 'click' || tool === 'fill')) {
              // Might be in another frame; ignore if not our target
              sendResponse({ ok: false, reason: 'Target not in this frame' });
              return;
            }

            let result = null;
            if (tool === 'click') {
              result = await window.PlaywrightDriver.click(target);
            } else if (tool === 'fill') {
              result = await window.PlaywrightDriver.fill(target, value || '');
            } else if (tool === 'press') {
              result = await window.PlaywrightDriver.press(target, key || 'Enter');
            } else if (tool === 'scroll') {
              result = await window.PlaywrightDriver.scroll(direction || 'down');
            } else {
              throw new Error(`Unsupported tool: ${tool}`);
            }

            sendResponse({ ok: true, tool, result });
            break;
          }

          default:
            sendResponse({ ok: false, reason: 'Unknown action' });
        }
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();

    return true; // Keep async channel open
  });
})();
