/**
 * Playwright-like Browser Automation Driver for Chrome Extension
 * Handles full pointer sequences, React/Vue synthetic event synchronization,
 * and reliable iframe-compatible DOM interactions.
 */

class PlaywrightDriver {
  /**
   * Dispatches a full synthetic pointer/mouse click sequence
   * @param {HTMLElement|string} target Element or CSS selector
   * @param {Object} options { force, timeout, clickCount }
   */
  static async click(target, options = {}) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw new Error(`PlaywrightDriver: Element not found for click target`);

    // Ensure visible & scrolled into view
    el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
    await this.sleep(30);

    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

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

    // Full pointer/mouse interaction sequence
    el.dispatchEvent(new PointerEvent('pointerover', eventInit));
    el.dispatchEvent(new MouseEvent('mouseover', eventInit));
    el.dispatchEvent(new PointerEvent('pointerdown', eventInit));
    el.dispatchEvent(new MouseEvent('mousedown', eventInit));

    // Simulate focus
    if (typeof el.focus === 'function') {
      el.focus();
    }

    await this.sleep(20);

    el.dispatchEvent(new PointerEvent('pointerup', { ...eventInit, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...eventInit, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...eventInit, buttons: 0 }));

    return { ok: true, targetId: el.getAttribute('data-sih-id') || null };
  }

  /**
   * Fills an input element, synchronizing with React/Vue/Angular state
   * @param {HTMLElement|string} target 
   * @param {string} value 
   */
  static async fill(target, value) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw new Error(`PlaywrightDriver: Target element not found for fill`);

    el.scrollIntoView({ behavior: 'instant', block: 'center' });
    if (typeof el.focus === 'function') el.focus();

    // Select existing text and clear
    if (typeof el.select === 'function') el.select();

    // Access native prototype value setter to trigger React/Vue synthetic events
    let prototype = window.HTMLInputElement.prototype;
    if (el.tagName.toLowerCase() === 'textarea') {
      prototype = window.HTMLTextAreaElement.prototype;
    } else if (el.tagName.toLowerCase() === 'select') {
      prototype = window.HTMLSelectElement.prototype;
    }

    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }

    // Dispatch input and change events
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    await this.sleep(15);

    return { ok: true, valueLength: value.length };
  }

  /**
   * Simulates keyboard press with keydown, keypress, keyup
   * @param {HTMLElement|string} target 
   * @param {string} key 
   */
  static async press(target, key) {
    const el = target ? (typeof target === 'string' ? document.querySelector(target) : target) : document.activeElement;
    const targetNode = el || document.body;

    const keyInit = {
      key: key,
      code: key === 'Enter' ? 'Enter' : (key === 'Tab' ? 'Tab' : `Key${key.toUpperCase()}`),
      bubbles: true,
      cancelable: true,
      view: window
    };

    targetNode.dispatchEvent(new KeyboardEvent('keydown', keyInit));
    targetNode.dispatchEvent(new KeyboardEvent('keypress', keyInit));
    await this.sleep(10);
    targetNode.dispatchEvent(new KeyboardEvent('keyup', keyInit));

    return { ok: true, key };
  }

  /**
   * Smoothly scrolls page or element
   * @param {"up"|"down"|"top"|"bottom"} direction 
   * @param {number} amount 
   */
  static async scroll(direction = 'down', amount = 350) {
    const delta = direction === 'down' ? amount : (direction === 'up' ? -amount : 0);
    if (direction === 'top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (direction === 'bottom') {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    } else {
      window.scrollBy({ top: delta, behavior: 'smooth' });
    }
    await this.sleep(200);
    return { ok: true, scrollY: window.scrollY };
  }

  /**
   * Waits for a selector to become visible in the DOM
   * @param {string} selector 
   * @param {number} timeoutMs 
   */
  static waitForSelector(selector, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(selector);
      if (existing && existing.offsetParent !== null) {
        return resolve(existing);
      }

      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timeout waiting for selector: ${selector}`));
      }, timeoutMs);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el && el.offsetParent !== null) {
          clearTimeout(timer);
          observer.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    });
  }

  static sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

// Attach to global scope in content script context
window.PlaywrightDriver = PlaywrightDriver;
