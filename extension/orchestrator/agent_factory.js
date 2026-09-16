/**
 * Dynamic Multi-Agent Factory & Lifecycle Coordinator
 * Spawns and manages specialized, parallel Needle2 agents:
 * - Conversation Agent (Voice/Chat IO)
 * - Response Agent (Voice TTS synthesis)
 * - Supervisor Agent (Workflow Strategy)
 * - Dynamic On-Demand Sub-Agents (Iframe, Form-Filler, PII Verifier)
 */

class AgentFactory {
  constructor(needlePool, memoryLayer, eventBus) {
    this.pool = needlePool;
    this.memory = memoryLayer;
    this.bus = eventBus;

    this.activeSubAgents = new Map(); // subAgentId -> { agent, type, stepCount }
    this.MAX_SUBAGENTS = 3;
    this.MAX_STEPS = 5;

    this._initPersistentAgents();
  }

  _initPersistentAgents() {
    this.pool.registerAgent('conversation_agent', 'conversation');
    this.pool.registerAgent('response_agent', 'response');
    this.pool.registerAgent('supervisor_agent', 'supervisor');

    // Response Agent listens for workflow milestones and triggers native TTS
    this.bus.on('MILESTONE_REACHED', async (event) => {
      await this.speakProgress(event.phase, event.detail);
    });
  }

  /**
   * Conversation Agent Turn: Handles user voice or text input
   */
  async handleUserInput(userGoalText) {
    this.memory.setPinnedGoal(userGoalText);

    const { prompt } = this.memory.buildAgentPrompt({
      systemInstruction: 'You are the Conversation Agent. Normalize user goal into a concise aim.',
      extraContext: userGoalText
    });

    const result = await this.pool.infer('conversation_agent', prompt);
    this.bus.emit('GOAL_ACCEPTED', { goal: this.memory.getPinnedGoal() });
    await this.speakProgress('scan', 'Goal registered. Inspecting screen and masking personal data.');
    return result;
  }

  /**
   * Response Agent Turn: Emits spoken voice status via native browser SpeechSynthesis
   */
  async speakProgress(phase, fallbackText) {
    const { prompt } = this.memory.buildAgentPrompt({
      systemInstruction: 'You are the Response Agent. Generate a 1-sentence audio status update for the user.',
      extraContext: `Phase: ${phase}. Detail: ${fallbackText || ''}`
    });

    const result = await this.pool.infer('response_agent', prompt, { phase });
    const speechText = result.output || fallbackText;

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      setTimeout(() => {
        try {
          if (window.speechSynthesis.paused) window.speechSynthesis.resume();
          const utterance = new SpeechSynthesisUtterance(speechText);
          utterance.rate = 1.05;
          utterance.pitch = 1.0;

          utterance.onstart = () => {
            this.bus.emit('AUDIO_START', { text: speechText });
          };
          utterance.onend = () => {
            this.bus.emit('AUDIO_FINISHED', { text: speechText });
          };
          utterance.onerror = () => {
            this.bus.emit('AUDIO_FINISHED', { text: speechText });
          };

          window.speechSynthesis.speak(utterance);
        } catch (err) {
          console.warn('[ResponseAgent] Speech synthesis notice:', err);
          this.bus.emit('AUDIO_FINISHED', { text: speechText });
        }
      }, 10);
    }

    this.bus.emit('AUDIO_SPOKEN', { text: speechText });
    return speechText;
  }

  /**
   * Supervisor Agent Turn: Evaluates page scan and dynamically spawns sub-agents
   */
  async evaluateAndDispatch(viewportScan) {
    const { elements = [], piiRects = [] } = viewportScan;
    this.bus.emit('SCAN_EVALUATED', { elementCount: elements.length, piiCount: piiRects.length });

    // Check for nested iframes
    const iframeElements = elements.filter(el => el.isIframe);
    if (iframeElements.length > 0) {
      return await this.spawnSubAgent('iframe_subagent', {
        elements: iframeElements,
        targetElement: iframeElements[0]
      });
    }

    // Check for form inputs
    const formInputs = elements.filter(el => el.tag === 'input' || el.tag === 'textarea' || el.tag === 'select');
    const submitBtn = elements.find(el => el.tag === 'button' || (el.tag === 'input' && el.type === 'submit'));

    if (formInputs.length > 0 || submitBtn) {
      return await this.spawnSubAgent('form_subagent', {
        elements,
        inputCandidate: formInputs[0] || null,
        submitCandidate: submitBtn || null,
        hasEmptyInputs: formInputs.length > 0
      });
    }

    // Default action
    return { status: 'idle', message: 'No actionable elements found in active viewport' };
  }

  /**
   * Dynamically Spawns an On-Demand Sub-Agent
   */
  async spawnSubAgent(type, contextData) {
    if (this.activeSubAgents.size >= this.MAX_SUBAGENTS) {
      console.warn('[AgentFactory] Max concurrent sub-agents reached. Cleaning up oldest.');
      const oldestKey = this.activeSubAgents.keys().next().value;
      this.destroySubAgent(oldestKey);
    }

    const subAgentId = `${type}_${Math.random().toString(36).substring(2, 7)}`;
    this.pool.registerAgent(subAgentId, type);
    this.activeSubAgents.set(subAgentId, { type, stepCount: 0 });

    this.bus.emit('SUBAGENT_SPAWNED', { subAgentId, type });

    // Acquire exclusive DOM Lock before sub-agent executes action
    const releaseLock = await this.bus.acquireDomLock(subAgentId);

    try {
      const { prompt, tokenCount } = this.memory.buildAgentPrompt({
        systemInstruction: `You are a specialized ${type}. Execute atomic browser action.`,
        candidateElements: contextData.elements || []
      });

      console.log(`[SubAgent:${subAgentId}] Executing turn with ${tokenCount} tokens`);

      // Run parallel inference turn
      const inferenceResult = await this.pool.infer(subAgentId, prompt, contextData);

      // Record in memory trace
      this.memory.recordAction(`${type} performed ${inferenceResult.structuredAction?.tool || 'action'}`);

      // Self-destruct after task completion or reaching max steps
      this.destroySubAgent(subAgentId);

      return {
        ok: true,
        subAgentId,
        action: inferenceResult.structuredAction,
        tokenCount
      };
    } finally {
      releaseLock();
    }
  }

  destroySubAgent(subAgentId) {
    this.pool.unregisterAgent(subAgentId);
    this.activeSubAgents.delete(subAgentId);
    this.bus.emit('SUBAGENT_TERMINATED', { subAgentId });
  }

  getActiveSubAgentCount() {
    return this.activeSubAgents.size;
  }
}

if (typeof window !== 'undefined') {
  window.AgentFactory = AgentFactory;
}
if (typeof module !== 'undefined') {
  module.exports = { AgentFactory };
}
