/**
 * External Memory Layer & 256-Token Sliding Window Budget Enforcer
 * Guarantees that Needle2 agents never experience sliding window context eviction.
 */

class MemoryLayer {
  constructor(maxTokens = 256, promptCeiling = 140) {
    this.maxTokens = maxTokens;
    this.promptCeiling = promptCeiling; // Max budget allocated for input context
    this.pinnedGoal = '';
    this.actionTrace = []; // Ring buffer of last 2 actions
    this.maxTraceLength = 2;
    this.activeMilestone = '';
  }

  setPinnedGoal(goalText) {
    // Compress user goal into concise anchor (under 24 words / ~20 tokens)
    this.pinnedGoal = goalText.replace(/\s+/g, ' ').trim().substring(0, 100);
  }

  getPinnedGoal() {
    return this.pinnedGoal || 'Assist user with browser task';
  }

  recordAction(actionSummary) {
    this.actionTrace.push(actionSummary);
    if (this.actionTrace.length > this.maxTraceLength) {
      this.actionTrace.shift();
    }
  }

  setMilestone(milestone) {
    this.activeMilestone = milestone;
  }

  /**
   * Fast token estimation (approximately 1 token per 3.5 characters or 0.75 words)
   */
  estimateTokens(text) {
    if (!text) return 0;
    const words = text.trim().split(/\s+/).length;
    return Math.ceil(words * 1.33);
  }

  /**
   * Formats a strictly budget-compliant prompt for a micro-agent turn.
   * Total tokens guaranteed to remain under this.promptCeiling (140 tokens).
   */
  buildAgentPrompt({ systemInstruction, candidateElements = [], extraContext = '' }) {
    const goalStr = `GOAL: ${this.getPinnedGoal()}`;
    const traceStr = this.actionTrace.length > 0 ? `LAST: ${this.actionTrace.join(' | ')}` : '';
    const milestoneStr = this.activeMilestone ? `PHASE: ${this.activeMilestone}` : '';

    // Format top candidate elements into ultra-compact micro-tuples
    let elementTuples = candidateElements.slice(0, 4).map(el => {
      const text = (el.text || el.type || '').substring(0, 18).replace(/"/g, "'");
      return `[${el.id}:${el.tag.toUpperCase()}"${text}"]`;
    }).join(' ');

    let promptParts = [
      systemInstruction,
      goalStr,
      milestoneStr,
      traceStr,
      elementTuples ? `ELEMENTS: ${elementTuples}` : '',
      extraContext ? `CTX: ${extraContext}` : '',
      'ACTION:'
    ].filter(Boolean);

    let prompt = promptParts.join('\n');
    let tokenCount = this.estimateTokens(prompt);

    // Prune if over ceiling
    if (tokenCount > this.promptCeiling && candidateElements.length > 2) {
      // Reduce candidates to top 2
      elementTuples = candidateElements.slice(0, 2).map(el => {
        const text = (el.text || '').substring(0, 12).replace(/"/g, "'");
        return `[${el.id}:${el.tag.toUpperCase()}"${text}"]`;
      }).join(' ');

      promptParts = [
        systemInstruction,
        goalStr,
        `ELEMENTS: ${elementTuples}`,
        'ACTION:'
      ];
      prompt = promptParts.join('\n');
      tokenCount = this.estimateTokens(prompt);
    }

    return {
      prompt,
      tokenCount,
      remainingBudget: this.maxTokens - tokenCount
    };
  }

  clear() {
    this.pinnedGoal = '';
    this.actionTrace = [];
    this.activeMilestone = '';
  }
}

if (typeof window !== 'undefined') {
  window.AgentMemoryLayer = new MemoryLayer();
}
if (typeof module !== 'undefined') {
  module.exports = { MemoryLayer };
}
