/**
 * CDP Controller: Chrome DevTools Protocol Hardware Automation & Accessibility Tree
 * Provides trusted hardware pointer events (isTrusted: true) and deep accessibility inspection
 * bypassing anti-bot synthetic event blocks.
 */

class CDPController {
  constructor() {
    this.attachedTabId = null;
    this.isAttaching = false;
    this.enabled = true;

    if (typeof chrome !== 'undefined' && chrome.debugger) {
      chrome.debugger.onDetach.addListener((source, reason) => {
        if (this.attachedTabId === source.tabId) {
          console.log(`[CDPController] Debugger detached from tab ${source.tabId}: ${reason}`);
          this.attachedTabId = null;
        }
      });
    }
  }

  /**
   * Attaches Chrome Debugger to a target tab
   */
  async attach(tabId) {
    if (!chrome.debugger || !tabId) return false;
    if (this.attachedTabId === tabId) return true;

    if (this.attachedTabId && this.attachedTabId !== tabId) {
      await this.detach(this.attachedTabId);
    }

    try {
      this.isAttaching = true;
      await chrome.debugger.attach({ tabId }, '1.3');
      this.attachedTabId = tabId;

      // Enable necessary CDP domains
      await this.sendCommand(tabId, 'DOM.enable').catch(() => {});
      await this.sendCommand(tabId, 'Accessibility.enable').catch(() => {});
      console.log(`[CDPController] Successfully attached to tab ${tabId}`);
      return true;
    } catch (err) {
      console.warn(`[CDPController] Attach failed for tab ${tabId}:`, err.message);
      this.attachedTabId = null;
      return false;
    } finally {
      this.isAttaching = false;
    }
  }

  /**
   * Detaches debugger from tab
   */
  async detach(tabId = null) {
    const target = tabId || this.attachedTabId;
    if (!chrome.debugger || !target) return;

    try {
      await chrome.debugger.detach({ tabId: target });
    } catch (_) {}

    if (this.attachedTabId === target) {
      this.attachedTabId = null;
    }
  }

  /**
   * Sends a low-level CDP command with promise resolution
   */
  sendCommand(tabId, method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!chrome.debugger) return reject(new Error('chrome.debugger API not available'));
      chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        resolve(result || {});
      });
    });
  }

  /**
   * Retrieves the full Accessibility Tree for semantic screen understanding
   */
  async getAccessibilityTree(tabId) {
    if (!tabId) return null;
    const attached = await this.attach(tabId);
    if (!attached) return null;

    try {
      const res = await this.sendCommand(tabId, 'Accessibility.getFullAXTree', { depth: -1 });
      const nodes = res.nodes || [];

      // Filter and simplify accessibility nodes into useful elements
      const actionable = [];
      for (const node of nodes) {
        if (!node || node.ignored) continue;
        const role = node.role?.value || '';
        const name = node.name?.value || '';
        const description = node.description?.value || '';
        const value = node.value?.value || '';

        // Only retain nodes with semantic value or user interactability
        const isInteractive = /button|link|textbox|searchbox|combobox|checkbox|radio|menuitem|tab|switch/i.test(role);
        const isStructural = /heading|alert|dialog|banner|main|form/i.test(role);

        if ((isInteractive && (name || value || description)) || (isStructural && name)) {
          actionable.push({
            nodeId: node.nodeId,
            role,
            name: name.substring(0, 80),
            value: value.substring(0, 60),
            description: description.substring(0, 80),
            backendDOMNodeId: node.backendDOMNodeId
          });
        }
      }

      return actionable;
    } catch (err) {
      console.warn('[CDPController] getAccessibilityTree error:', err.message);
      return null;
    }
  }

  /**
   * Dispatches true trusted physical hardware mouse click (isTrusted: true)
   */
  async clickAt(tabId, x, y) {
    if (!tabId || x === undefined || y === undefined) return false;
    const attached = await this.attach(tabId);
    if (!attached) return false;

    const roundX = Math.round(x);
    const roundY = Math.round(y);

    try {
      // 1. Move to position
      await this.sendCommand(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: roundX,
        y: roundY
      });

      // 2. Press mouse button
      await this.sendCommand(tabId, 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: roundX,
        y: roundY,
        button: 'left',
        clickCount: 1
      });

      // Brief physical delay
      await new Promise(r => setTimeout(r, 45));

      // 3. Release mouse button
      await this.sendCommand(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: roundX,
        y: roundY,
        button: 'left',
        clickCount: 1
      });

      return true;
    } catch (err) {
      console.warn('[CDPController] clickAt error:', err.message);
      return false;
    }
  }

  /**
   * Types text using CDP trusted hardware keyboard events
   */
  async typeText(tabId, text) {
    if (!tabId || !text) return false;
    const attached = await this.attach(tabId);
    if (!attached) return false;

    try {
      await this.sendCommand(tabId, 'Input.insertText', { text });
      return true;
    } catch (err) {
      console.warn('[CDPController] typeText error:', err.message);
      return false;
    }
  }

  /**
   * Dispatches a special hardware key press (Enter, Escape, Tab, Backspace)
   */
  async pressKey(tabId, keyName) {
    if (!tabId || !keyName) return false;
    const attached = await this.attach(tabId);
    if (!attached) return false;

    const keyMap = {
      'Enter': { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
      'Tab': { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
      'Escape': { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
      'Backspace': { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
      'ArrowDown': { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
      'ArrowUp': { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 }
    };

    const def = keyMap[keyName] || { key: keyName, code: keyName };

    try {
      await this.sendCommand(tabId, 'Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key: def.key,
        code: def.code,
        windowsVirtualKeyCode: def.windowsVirtualKeyCode,
        text: def.text || ''
      });

      await new Promise(r => setTimeout(r, 30));

      await this.sendCommand(tabId, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: def.key,
        code: def.code,
        windowsVirtualKeyCode: def.windowsVirtualKeyCode
      });

      return true;
    } catch (err) {
      console.warn('[CDPController] pressKey error:', err.message);
      return false;
    }
  }
}

// Attach to global context (accessible in Service Worker)
if (typeof self !== 'undefined') {
  self.cdpController = new CDPController();
}
