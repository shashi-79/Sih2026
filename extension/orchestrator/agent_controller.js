/**
 * Agent Controller: Gemma 4 Autonomous Workflow Coordinator
 * Manages the multi-step observe-think-act-speak execution loop on the active browser tab.
 */

class AgentController {
  constructor(gemmaRunner, eventBus, voiceController) {
    this.runner = gemmaRunner;
    this.bus = eventBus;
    this.voice = voiceController;

    this.isRunning = false;
    this.isPaused = false;
    this.currentGoal = '';
    this.actionHistory = [];
    this.maxSteps = 10;
    this.currentStep = 0;
  }

  /**
   * Starts an autonomous browser control workflow
   */
  async executeGoal(goalText) {
    if (this.isRunning) {
      console.warn('[AgentController] Already running a workflow. Stopping previous.');
      await this.stop();
    }

    this.isRunning = true;
    this.isPaused = false;
    this.currentGoal = (goalText || '').trim();
    this.actionHistory = [];
    this.currentStep = 0;

    this.bus.emit('WORKFLOW_STARTED', { goal: this.currentGoal });

    if (this.voice) {
      await this.voice.speak(`Starting task: ${this.currentGoal}`);
    }

    try {
      while (this.isRunning && this.currentStep < this.maxSteps) {
        if (this.isPaused) {
          await this.sleep(300);
          continue;
        }

        this.currentStep++;
        this.bus.emit('STEP_STARTED', { step: this.currentStep, maxSteps: this.maxSteps });

        // 1. OBSERVE: Query active tab DOM with Set-of-Marks badges
        const pageState = await this.queryPageState();
        if (!pageState || !pageState.elements) {
          throw new Error('Could not inspect active page DOM');
        }

        // 2. THINK: Run Gemma 4 inference turn
        this.bus.emit('AGENT_THINKING', { step: this.currentStep });
        const plan = await this.runner.planNextAction(this.currentGoal, pageState, this.actionHistory);
        const actionObj = plan.action || {};

        this.bus.emit('AGENT_DECIDED', {
          step: this.currentStep,
          plan: actionObj,
          source: plan.source,
          durationMs: plan.durationMs
        });

        // 3. SPEAK: Audio status feedback if Gemma generated speech
        if (actionObj.speech && this.voice) {
          this.voice.speak(actionObj.speech);
        }

        // 4. CHECK COMPLETION
        if (actionObj.action === 'done') {
          this.bus.emit('WORKFLOW_COMPLETED', {
            goal: this.currentGoal,
            summary: actionObj.speech || 'Task completed successfully',
            stepsTaken: this.currentStep
          });
          await this.cleanupBadges();
          this.isRunning = false;
          return { ok: true, completed: true, steps: this.currentStep };
        }

        // 5. ACT: Execute Playwright tool on active webpage
        this.bus.emit('TOOL_EXECUTING', { action: actionObj });
        const execResult = await this.executeTool(actionObj);

        // Record in history
        this.actionHistory.push({
          step: this.currentStep,
          action: actionObj.action,
          target: actionObj.target,
          thought: actionObj.thought,
          result: execResult
        });

        this.bus.emit('STEP_FINISHED', { step: this.currentStep, result: execResult });

        // Wait for page reaction / network settlement
        await this.sleep(1200);
      }

      if (this.currentStep >= this.maxSteps) {
        const timeoutMsg = `Reached maximum step limit of ${this.maxSteps} steps.`;
        if (this.voice) await this.voice.speak(timeoutMsg);
        this.bus.emit('WORKFLOW_STOPPED', { reason: timeoutMsg });
      }
    } catch (err) {
      console.error('[AgentController] Workflow execution error:', err);
      this.bus.emit('WORKFLOW_ERROR', { error: err.message });
      if (this.voice) await this.voice.speak(`Error during task: ${err.message}`);
    } finally {
      this.isRunning = false;
      await this.cleanupBadges();
    }
  }

  /**
   * Queries active tab state from background service worker
   */
  queryPageState() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'GET_ACTIVE_PAGE_STATE', showBadges: true }, (resp) => {
        if (chrome.runtime.lastError || !resp || !resp.ok) {
          resolve({ title: 'Error', url: '', elements: [] });
        } else {
          resolve(resp.state || { elements: [] });
        }
      });
    });
  }

  /**
   * Sends tool execution request to background service worker
   */
  executeTool(actionObj) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'EXECUTE_PAGE_TOOL',
        tool: actionObj.action,
        target: actionObj.target,
        value: actionObj.value,
        key: actionObj.key,
        direction: actionObj.direction,
        url: actionObj.url
      }, (resp) => {
        resolve(resp);
      });
    });
  }

  /**
   * Removes Set-of-Marks badges from the webpage
   */
  cleanupBadges() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'CLEAR_PAGE_BADGES' }, () => resolve());
    });
  }

  pause() {
    this.isPaused = true;
    this.bus.emit('WORKFLOW_PAUSED');
  }

  resume() {
    this.isPaused = false;
    this.bus.emit('WORKFLOW_RESUMED');
  }

  async stop() {
    this.isRunning = false;
    this.isPaused = false;
    await this.cleanupBadges();
    this.bus.emit('WORKFLOW_STOPPED', { reason: 'User requested stop' });
  }

  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

if (typeof window !== 'undefined') {
  window.AgentController = AgentController;
}
if (typeof module !== 'undefined') {
  module.exports = { AgentController };
}
