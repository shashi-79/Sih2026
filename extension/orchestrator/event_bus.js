/**
 * Micro-Envelope Event Bus & DOM Execution Mutex Lock
 * Enables parallel agent execution while strictly preventing concurrent DOM manipulation collisions.
 */

class EventBus {
  constructor() {
    this.listeners = new Map();
    this.domLockHolder = null;
    this.lockQueue = [];
  }

  on(eventType, callback) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType).add(callback);
    return () => this.off(eventType, callback);
  }

  off(eventType, callback) {
    if (this.listeners.has(eventType)) {
      this.listeners.get(eventType).delete(callback);
    }
  }

  emit(eventType, payload = {}) {
    const handlers = this.listeners.get(eventType);
    if (!handlers || handlers.size === 0) return;

    // Dispatch asynchronously to prevent call stack recursion
    for (const cb of handlers) {
      try {
        Promise.resolve().then(() => cb(payload));
      } catch (err) {
        console.error(`[VisionAgent:EventBus] Error in handler for '${eventType}':`, err);
      }
    }
  }

  /**
   * Acquires the exclusive DOM Execution Mutex Lock
   * @param {string} agentId 
   * @returns {Promise<Function>} releaseLock callback
   */
  async acquireDomLock(agentId) {
    if (this.domLockHolder === null) {
      this.domLockHolder = agentId;
      this.emit('DOM_LOCK_ACQUIRED', { agentId });
      return () => this.releaseDomLock(agentId);
    }

    // Wait in queue
    return new Promise((resolve) => {
      this.lockQueue.push({ agentId, resolve });
    });
  }

  releaseDomLock(agentId) {
    if (this.domLockHolder !== agentId) return;

    if (this.lockQueue.length > 0) {
      const next = this.lockQueue.shift();
      this.domLockHolder = next.agentId;
      this.emit('DOM_LOCK_ACQUIRED', { agentId: next.agentId });
      next.resolve(() => this.releaseDomLock(next.agentId));
    } else {
      this.domLockHolder = null;
      this.emit('DOM_LOCK_RELEASED', { agentId });
    }
  }
}

// Export as constructor and singleton on window
if (typeof window !== 'undefined') {
  window.EventBus = EventBus;
  window.AgentEventBus = new EventBus();
}
if (typeof module !== 'undefined') {
  module.exports = { EventBus };
}
