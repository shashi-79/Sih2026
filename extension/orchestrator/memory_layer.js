/**
 * Memory Layer: Working Context & Action History for Gemma 4
 * Stores active goals, recent observation traces, and session state.
 */

class MemoryLayer {
  constructor(maxHistory = 10) {
    this.maxHistory = maxHistory;
    this.pinnedGoal = '';
    this.actionTrace = [];
    this.pageContext = null;
  }

  setPinnedGoal(goalText) {
    this.pinnedGoal = (goalText || '').trim();
  }

  getPinnedGoal() {
    return this.pinnedGoal;
  }

  recordAction(actionObj) {
    this.actionTrace.push({
      ...actionObj,
      timestamp: Date.now()
    });
    if (this.actionTrace.length > this.maxHistory) {
      this.actionTrace.shift();
    }
  }

  getActionTrace() {
    return [...this.actionTrace];
  }

  clear() {
    this.pinnedGoal = '';
    this.actionTrace = [];
    this.pageContext = null;
  }
}

if (typeof window !== 'undefined') {
  window.MemoryLayer = MemoryLayer;
}
if (typeof module !== 'undefined') {
  module.exports = { MemoryLayer };
}
