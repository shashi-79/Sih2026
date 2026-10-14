/**
 * Playwright-like Browser Automation Driver for Chrome Extension
 * Handles full pointer sequences, React/Vue synthetic event synchronization,
 * keyboard dispatching, dropdown selection, and reliable DOM interactions.
 */

(function () {
  if (typeof window !== 'undefined' && window.PlaywrightDriver && typeof window.PlaywrightDriver.injectScript === 'function') {
    return;
  }

  class PlaywrightDriver {
  static cursorState = {
    x: null,
    y: null,
    cursorEl: null,
    styleInjected: false
  };

  /**
   * Ensures the visual AI mouse cursor and ripple styling exist in DOM
   */
  static ensureCursor() {
    if (typeof document === 'undefined') return null;

    if (!this.cursorState.styleInjected) {
      const styleId = '__gemma_cursor_style__';
      if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
          #__gemma_agent_cursor__ {
            position: fixed;
            top: 0;
            left: 0;
            width: 26px;
            height: 26px;
            pointer-events: none !important;
            z-index: 2147483647 !important;
            transform: translate3d(-100px, -100px, 0);
            transition: none;
            will-change: transform;
            user-select: none;
          }
          .__gemma_cursor_ripple__ {
            position: fixed;
            pointer-events: none !important;
            z-index: 2147483646 !important;
            border-radius: 50%;
            border: 2px solid #38bdf8;
            background: rgba(56, 189, 248, 0.28);
            transform: translate(-50%, -50%) scale(0.3);
            opacity: 1;
            transition: transform 0.38s cubic-bezier(0.1, 0.8, 0.3, 1), opacity 0.38s ease-out;
          }
        `;
        (document.head || document.documentElement).appendChild(style);
      }
      this.cursorState.styleInjected = true;
    }

    let cursorEl = document.getElementById('__gemma_agent_cursor__');
    if (!cursorEl) {
      cursorEl = document.createElement('div');
      cursorEl.id = '__gemma_agent_cursor__';
      cursorEl.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 6px rgba(0,0,0,0.5));">
          <path d="M0 0L6.5 19L10.5 12L18 8.5L0 0Z" fill="url(#__gemma_c_grad__)" stroke="#FFFFFF" stroke-width="1.4" stroke-linejoin="round"/>
          <defs>
            <linearGradient id="__gemma_c_grad__" x1="0" y1="0" x2="18" y2="19" gradientUnits="userSpaceOnUse">
              <stop stop-color="#38BDF8"/>
              <stop offset="1" stop-color="#818CF8"/>
            </linearGradient>
          </defs>
        </svg>
        <div style="position: absolute; left: 16px; top: 13px; background: rgba(15, 23, 42, 0.88); color: #38BDF8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 9px; font-weight: 800; padding: 1px 4px; border-radius: 3px; border: 1px solid rgba(56, 189, 248, 0.55); pointer-events: none; white-space: nowrap; box-shadow: 0 2px 6px rgba(0,0,0,0.35); letter-spacing: 0.5px;">AI</div>
      `;
      (document.body || document.documentElement).appendChild(cursorEl);
    }
    this.cursorState.cursorEl = cursorEl;

    if (this.cursorState.x === null || this.cursorState.y === null) {
      this.cursorState.x = Math.round((window.innerWidth || 800) / 2);
      this.cursorState.y = Math.max(10, Math.round((window.innerHeight || 600) - 60));
      cursorEl.style.transform = `translate3d(${this.cursorState.x}px, ${this.cursorState.y}px, 0)`;
    }

    return cursorEl;
  }

  /**
   * Displays an animated expanding ripple ring at click coordinates
   */
  static showClickRipple(x, y) {
    if (typeof document === 'undefined') return;
    this.ensureCursor();

    const ripple = document.createElement('div');
    ripple.className = '__gemma_cursor_ripple__';
    ripple.style.left = `${Math.round(x)}px`;
    ripple.style.top = `${Math.round(y)}px`;
    ripple.style.width = '26px';
    ripple.style.height = '26px';
    (document.body || document.documentElement).appendChild(ripple);

    requestAnimationFrame(() => {
      ripple.style.transform = 'translate(-50%, -50%) scale(2.4)';
      ripple.style.opacity = '0';
    });

    setTimeout(() => {
      if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
    }, 420);
  }

  /**
   * Smoothly animates the virtual mouse cursor to target coordinates,
   * firing intermediate pointermove / mousemove events along the trajectory
   * @param {number} targetX 
   * @param {number} targetY 
   * @param {number} durationMs 
   */
  static async moveMouse(targetX, targetY, durationMs = 260) {
    const cursor = this.ensureCursor();
    const startX = this.cursorState.x !== null ? this.cursorState.x : targetX;
    const startY = this.cursorState.y !== null ? this.cursorState.y : targetY;

    const dx = targetX - startX;
    const dy = targetY - startY;
    const distance = Math.hypot(dx, dy);

    // If already at or very close to target, update directly
    if (distance < 4 || durationMs <= 20) {
      this.cursorState.x = targetX;
      this.cursorState.y = targetY;
      if (cursor) {
        cursor.style.transform = `translate3d(${Math.round(targetX)}px, ${Math.round(targetY)}px, 0)`;
      }
      const el = document.elementFromPoint(targetX, targetY);
      if (el) {
        const moveInit = { bubbles: true, cancelable: true, view: window, clientX: targetX, clientY: targetY };
        el.dispatchEvent(new PointerEvent('pointermove', moveInit));
        el.dispatchEvent(new MouseEvent('mousemove', moveInit));
      }
      return { ok: true, x: targetX, y: targetY };
    }

    const steps = Math.max(8, Math.min(24, Math.round(durationMs / 16)));
    const stepDelay = durationMs / steps;

    for (let i = 1; i <= steps; i++) {
      const progress = i / steps;
      // Smooth easeInOutQuad curve
      const ease = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
      const curX = startX + dx * ease;
      const curY = startY + dy * ease;

      if (cursor) {
        cursor.style.transform = `translate3d(${Math.round(curX)}px, ${Math.round(curY)}px, 0)`;
      }

      // Fire mousemove & pointermove on element beneath cursor every couple of steps
      if (i % 2 === 0 || i === steps) {
        try {
          const underEl = document.elementFromPoint(curX, curY);
          if (underEl) {
            const moveInit = {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: Math.round(curX),
              clientY: Math.round(curY)
            };
            underEl.dispatchEvent(new PointerEvent('pointermove', moveInit));
            underEl.dispatchEvent(new MouseEvent('mousemove', moveInit));
          }
        } catch (_) {}
      }

      await this.sleep(stepDelay);
    }

    this.cursorState.x = targetX;
    this.cursorState.y = targetY;
    return { ok: true, x: targetX, y: targetY };
  }

  /**
   * Moves the virtual mouse cursor smoothly to the center of a target element
   * @param {HTMLElement|string} target 
   * @param {number} durationMs 
   */
  static async moveToElement(target, durationMs = 260) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw new Error(`PlaywrightDriver: Target not found for moveToElement`);

    el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
    await this.sleep(20);

    const rect = el.getBoundingClientRect();
    const targetX = rect.left + rect.width / 2;
    const targetY = rect.top + rect.height / 2;

    await this.moveMouse(targetX, targetY, durationMs);
    return { ok: true, x: targetX, y: targetY, targetId: el.getAttribute('data-gemma-badge') || null };
  }

  /**
   * Dispatches a full synthetic pointer/mouse click sequence
   * @param {HTMLElement|string} target Element or CSS selector
   */
  static async click(target) {
    let el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw new Error(`PlaywrightDriver: Element not found for click target`);

    // If node was detached by page re-render, attempt to re-query live node
    if (!el.isConnected) {
      const badge = el.getAttribute ? el.getAttribute('data-gemma-badge') : null;
      if (badge) {
        const reFound = document.querySelector(`[data-gemma-badge="${badge}"]`);
        if (reFound) el = reFound;
      }
    }

    el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
    await this.sleep(30);

    const anchor = el.tagName && el.tagName.toLowerCase() === 'a' ? el : (el.closest ? el.closest('a') : null) || (el.querySelector ? el.querySelector('a') : null);
    let cleanNavUrl = null;

    if (anchor) {
      const rawHref = (anchor.getAttribute('href') || anchor.href || '').toString().trim();
      if (rawHref && !rawHref.startsWith('javascript:') && !rawHref.startsWith('#')) {
        try {
          const absUrl = new URL(rawHref, window.location.href);
          cleanNavUrl = absUrl.href;
          if (cleanNavUrl.includes('/url?') || cleanNavUrl.includes('url=http') || absUrl.pathname === '/url') {
            const qParam = absUrl.searchParams.get('url') || absUrl.searchParams.get('q');
            if (qParam && /^https?:\/\//i.test(qParam)) {
              cleanNavUrl = decodeURIComponent(qParam);
            }
          }
        } catch (_) {
          cleanNavUrl = rawHref;
        }

        // Prevent popup blocker from silently swallowing programmatic clicks on target="_blank"
        if (anchor.getAttribute('target') === '_blank') {
          anchor.setAttribute('target', '_self');
        }
      }
    }

    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

    // Smoothly glide virtual AI mouse cursor to target element
    await this.moveMouse(clientX, clientY, 200);
    this.showClickRipple(clientX, clientY);
    await this.sleep(30);

    const eventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY,
      screenX: clientX,
      screenY: clientY,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 1
    };

    el.dispatchEvent(new PointerEvent('pointerover', eventInit));
    el.dispatchEvent(new MouseEvent('mouseover', eventInit));
    el.dispatchEvent(new PointerEvent('pointerdown', eventInit));
    el.dispatchEvent(new MouseEvent('mousedown', eventInit));

    if (typeof el.focus === 'function') el.focus();
    await this.sleep(20);

    el.dispatchEvent(new PointerEvent('pointerup', { ...eventInit, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...eventInit, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...eventInit, buttons: 0 }));

    // Native click triggers browser standard link navigation and form submit
    try {
      if (typeof el.click === 'function') {
        el.click();
      }
      if (anchor && anchor !== el && typeof anchor.click === 'function') {
        anchor.click();
      }
      if (cleanNavUrl && /^https?:\/\//i.test(cleanNavUrl) && !cleanNavUrl.startsWith(window.location.href + '#')) {
        setTimeout(() => {
          if (window.location.href !== cleanNavUrl && !cleanNavUrl.endsWith('#')) {
            try {
              window.location.assign(cleanNavUrl);
            } catch (_) {
              window.location.href = cleanNavUrl;
            }
          }
        }, 80);
      }
    } catch (_) {}

    return {
      ok: true,
      action: 'click',
      targetId: el.getAttribute('data-gemma-badge') || null,
      navigatedUrl: cleanNavUrl || null
    };
  }

  /**
   * Dispatches synthetic hover / mouseover sequence
   * @param {HTMLElement|string} target
   */
  static async hover(target) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw new Error(`PlaywrightDriver: Element not found for hover target`);

    el.scrollIntoView({ behavior: 'instant', block: 'center' });
    await this.sleep(20);

    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

    // Smoothly glide virtual AI mouse cursor to target element
    await this.moveMouse(clientX, clientY, 220);

    const eventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY
    };

    el.dispatchEvent(new PointerEvent('pointerover', eventInit));
    el.dispatchEvent(new MouseEvent('mouseover', eventInit));
    el.dispatchEvent(new MouseEvent('mouseenter', eventInit));
    el.dispatchEvent(new MouseEvent('mousemove', eventInit));

    return { ok: true, action: 'hover', x: clientX, y: clientY };
  }

  /**
   * Fills an input element, synchronizing with React/Vue/Angular state
   * @param {HTMLElement|string} target 
   * @param {string} value 
   */
  static async fill(target, value) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw new Error(`PlaywrightDriver: Target element not found for fill`);

    const textToFill = value !== undefined && value !== null ? String(value) : '';

    el.scrollIntoView({ behavior: 'instant', block: 'center' });
    await this.sleep(20);

    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

    // Smoothly glide virtual AI mouse cursor to input element
    await this.moveMouse(clientX, clientY, 180);
    this.showClickRipple(clientX, clientY);
    await this.sleep(25);

    // 1. Synthetic pointer activation & focus (activates dynamic search handlers on Google, YouTube, React)
    try {
      const ptrInit = { bubbles: true, cancelable: true, view: window, clientX, clientY };
      el.dispatchEvent(new PointerEvent('pointerdown', ptrInit));
      el.dispatchEvent(new MouseEvent('mousedown', ptrInit));
      el.dispatchEvent(new PointerEvent('pointerup', ptrInit));
      el.dispatchEvent(new MouseEvent('mouseup', ptrInit));
      el.dispatchEvent(new MouseEvent('click', ptrInit));
    } catch (_) {}

    if (typeof el.focus === 'function') {
      try { el.focus(); } catch (_) {}
    }
    await this.sleep(20);

    // 2. ContentEditable / Rich-text element support
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true' || el.getAttribute('role') === 'textbox') {
      try {
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
      } catch (_) {
        el.innerText = '';
      }

      let inserted = false;
      try {
        inserted = document.execCommand('insertText', false, textToFill);
      } catch (_) {}
      if (!inserted) {
        el.textContent = textToFill;
      }

      el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, composed: true, inputType: 'insertText', data: textToFill }));
      el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: textToFill }));
      el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      await this.sleep(25);
      return { ok: true, action: 'fill', valueLength: textToFill.length };
    }

    // 3. Clear existing text via select if available
    if (typeof el.select === 'function') {
      try { el.select(); } catch (_) {}
    }

    // 4. React 16+ input tracker hack (ensures synthetic onChange detects difference)
    const tracker = el._valueTracker;
    if (tracker) {
      try { tracker.setValue(''); } catch (_) {}
    }

    // 5. Prototype setter invocation (bypasses component wrappers)
    let prototype = window.HTMLInputElement.prototype;
    const tagName = el.tagName ? el.tagName.toLowerCase() : '';
    if (tagName === 'textarea') {
      prototype = window.HTMLTextAreaElement.prototype;
    } else if (tagName === 'select') {
      prototype = window.HTMLSelectElement.prototype;
    }

    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, textToFill);
    } else {
      el.value = textToFill;
    }

    // 6. Comprehensive event firing matching real user typing
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified', bubbles: true, cancelable: true, view: window }));
    try {
      el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, composed: true, inputType: 'insertText', data: textToFill }));
    } catch (_) {}
    try {
      el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: textToFill }));
    } catch (_) {
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Unidentified', bubbles: true, cancelable: true, view: window }));
    await this.sleep(25);

    return { ok: true, action: 'fill', valueLength: textToFill.length };
  }

  /**
   * Clears value from an input element
   * @param {HTMLElement|string} target 
   */
  static async clear(target) {
    return await this.fill(target, '');
  }

  /**
   * Selects an option inside a <select> dropdown by text or value
   * @param {HTMLSelectElement|string} target 
   * @param {string} valueOrText 
   */
  static async selectOption(target, valueOrText) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el || el.tagName.toLowerCase() !== 'select') {
      throw new Error('Target is not a valid <select> dropdown element');
    }

    const options = Array.from(el.options);
    const match = options.find(o => 
      o.value.toLowerCase() === valueOrText.toLowerCase() || 
      o.text.toLowerCase().includes(valueOrText.toLowerCase())
    );

    if (match) {
      el.value = match.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, selected: match.text, value: match.value };
    }

    throw new Error(`Option "${valueOrText}" not found in dropdown`);
  }

  /**
   * Sets checkbox or radio button state
   * @param {HTMLInputElement|string} target 
   * @param {boolean} checked 
   */
  static async setChecked(target, checked = true) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw new Error('Target not found for check/uncheck');

    if (el.checked !== checked) {
      el.checked = checked;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    return { ok: true, checked: el.checked };
  }

  /**
   * Simulates keyboard press with keydown, keypress, keyup
   * @param {HTMLElement|string} target 
   * @param {string} key 
   */
  static async press(target, key) {
    const el = target ? (typeof target === 'string' ? document.querySelector(target) : target) : document.activeElement;
    const targetNode = el || document.body;

    const isEnter = key === 'Enter';
    const keyCode = isEnter ? 13 : (key === 'Escape' ? 27 : (key === 'Tab' ? 9 : (key === 'Backspace' ? 8 : (key ? key.charCodeAt(0) : 0))));

    const keyInit = {
      key: key,
      code: isEnter ? 'Enter' : (key === 'Tab' ? 'Tab' : (key === 'Escape' ? 'Escape' : (key === 'Backspace' ? 'Backspace' : `Key${key.toUpperCase()}`))),
      keyCode: keyCode,
      which: keyCode,
      charCode: isEnter ? 13 : 0,
      bubbles: true,
      cancelable: true,
      view: window
    };

    targetNode.dispatchEvent(new KeyboardEvent('keydown', keyInit));
    targetNode.dispatchEvent(new KeyboardEvent('keypress', keyInit));
    await this.sleep(20);
    targetNode.dispatchEvent(new KeyboardEvent('keyup', keyInit));

    if (isEnter) {
      let submitted = false;
      if (targetNode.form && typeof targetNode.form.requestSubmit === 'function') {
        try {
          targetNode.form.requestSubmit();
          submitted = true;
        } catch (_) {
          try {
            targetNode.form.submit();
            submitted = true;
          } catch (_) {}
        }
      }
      if (!submitted) {
        // Fallback: locate submit or search button in closest form or container, or YouTube/Google search button
        const container = targetNode.closest('form') || targetNode.parentElement;
        let submitBtn = container ? container.querySelector('button[type="submit"], input[type="submit"], [role="button"][aria-label*="search" i], button[aria-label*="search" i]') : null;
        if (!submitBtn) {
          submitBtn = document.querySelector('button#search-icon-legacy, ytd-searchbox button#search-icon-legacy, button[aria-label*="search" i], input[type="submit"]');
        }
        if (submitBtn && typeof submitBtn.click === 'function') {
          try { submitBtn.click(); submitted = true; } catch (_) {}
        }
      }

      // Search engine direct navigation fallback: If form submission didn't trigger navigation
      const currentHost = (window.location && window.location.hostname) || '';
      const currentPath = (window.location && window.location.pathname) || '';
      const queryVal = (targetNode.value || document.querySelector('textarea[name="q"], input[name="q"], input[name="search_query"]')?.value || '').trim();

      if (queryVal) {
        if (/google\./i.test(currentHost) && !currentPath.startsWith('/search')) {
          setTimeout(() => {
            if (!window.location.pathname.startsWith('/search')) {
              window.location.href = `https://www.google.com/search?q=${encodeURIComponent(queryVal)}`;
            }
          }, 450);
        } else if (/youtube\./i.test(currentHost) && !currentPath.startsWith('/results')) {
          setTimeout(() => {
            if (!window.location.pathname.startsWith('/results')) {
              window.location.href = `https://www.youtube.com/results?search_query=${encodeURIComponent(queryVal)}`;
            }
          }, 450);
        }
      }
    }

    return { ok: true, key };
  }

  /**
   * Universally and physically scrolls the page or container
   * Dispatches synthetic wheel events, keyboard scrolling, and direct container offsets
   * @param {"up"|"down"|"top"|"bottom"} direction 
   * @param {number} amount 
   */
  static async scroll(direction = 'down', amount = 500) {
    const delta = direction === 'down' ? amount : (direction === 'up' ? -amount : (direction === 'top' ? -999999 : 999999));
    const scrollTarget = document.activeElement || document.scrollingElement || document.body || document.documentElement;

    // 1. Dispatch synthetic WheelEvent (activates JS scroll listeners, infinite feeds, and maps)
    try {
      scrollTarget.dispatchEvent(new WheelEvent('wheel', {
        deltaY: delta,
        deltaMode: 0,
        bubbles: true,
        cancelable: true,
        view: window
      }));
    } catch (_) {}

    // 2. Dispatch Keyboard navigation event (PageDown/PageUp/Home/End)
    try {
      const isDown = direction === 'down' || direction === 'bottom';
      const key = direction === 'top' ? 'Home' : (direction === 'bottom' ? 'End' : (isDown ? 'PageDown' : 'PageUp'));
      const keyCode = direction === 'top' ? 36 : (direction === 'bottom' ? 35 : (isDown ? 34 : 33));
      scrollTarget.dispatchEvent(new KeyboardEvent('keydown', {
        key,
        code: key,
        keyCode,
        which: keyCode,
        bubbles: true,
        cancelable: true,
        view: window
      }));
    } catch (_) {}

    // 3. Direct DOM scrolling across all possible scroll targets
    if (direction === 'top') {
      window.scrollTo(0, 0);
      if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
    } else if (direction === 'bottom') {
      const max = Math.max(
        document.body ? document.body.scrollHeight : 0,
        document.documentElement ? document.documentElement.scrollHeight : 0,
        10000
      );
      window.scrollTo(0, max);
      if (document.scrollingElement) document.scrollingElement.scrollTop = max;
      if (document.documentElement) document.documentElement.scrollTop = max;
      if (document.body) document.body.scrollTop = max;
    } else {
      window.scrollBy({ top: delta, behavior: 'instant' });
      window.scrollBy({ top: delta, behavior: 'smooth' });

      if (document.scrollingElement) {
        document.scrollingElement.scrollTop += delta;
      }
      if (document.documentElement) {
        document.documentElement.scrollTop += delta;
      }
      if (document.body) {
        document.body.scrollTop += delta;
      }

      // Also scroll any scrollable inner overflow containers (Google results, Reddit, modals, feeds)
      const containers = document.querySelectorAll('#cnt, #rcnt, #center_col, main, article, [role="main"], [role="feed"], div[style*="overflow"]');
      for (const c of containers) {
        if (c.scrollHeight > c.clientHeight + 40 && c.clientHeight > 200) {
          try {
            c.scrollTop += delta;
          } catch (_) {}
        }
      }
    }

    await this.sleep(180);
    const currentY = window.scrollY || (document.scrollingElement ? document.scrollingElement.scrollTop : 0);
    return { ok: true, scrollY: currentY, delta, direction };
  }

  /**
   * Injects and executes custom JavaScript in the active webpage
   * Supports both synchronous evaluation and asynchronous Promise results
   * @param {string} script 
   */
  static async injectScript(script) {
    if (!script || typeof script !== 'string') {
      throw new Error('PlaywrightDriver: injectScript requires valid script code string');
    }

    try {
      // 1. Try script element execution in main page context
      const scriptEl = document.createElement('script');
      const callId = `__gemma_script_${Math.random().toString(36).substring(2, 9)}__`;
      scriptEl.textContent = `
        (() => {
          try {
            window['${callId}'] = { ok: true, result: (0, eval)(${JSON.stringify(script)}) };
          } catch (e) {
            window['${callId}'] = { ok: false, error: e.message };
          }
        })();
      `;
      (document.head || document.documentElement).appendChild(scriptEl);
      scriptEl.remove();

      let pageRes = window[callId];
      if (pageRes) {
        delete window[callId];
        return pageRes;
      }

      // 2. Direct Function eval fallback
      let evalVal;
      try {
        evalVal = (new Function(`return (${script})`))();
      } catch (_) {
        evalVal = (new Function(script))();
      }
      if (evalVal && typeof evalVal.then === 'function') {
        evalVal = await evalVal;
      }
      return { ok: true, result: evalVal !== undefined ? evalVal : 'Executed successfully' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  static sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

  if (typeof window !== 'undefined') {
    window.PlaywrightDriver = PlaywrightDriver;
  }
  if (typeof module !== 'undefined') {
    module.exports = { PlaywrightDriver };
  }
})();
