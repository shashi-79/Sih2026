/**
 * Gemma 4 & Chrome Built-in AI (window.ai) Runner
 * Executes inference directly via Chrome's native on-device engine (window.ai / ai.languageModel)
 * with zero model downloads and zero memory crashes, with fallback to background engine.
 */

class Gemma4Runner {
  constructor(options = {}) {
    this.modelName = options.modelName || 'chrome-builtin-window.ai';
    this.temperature = options.temperature || 0.2;
    this.maxTokens = options.maxTokens || 350;
    this.session = null;
    this.systemPrompt = `You are an autonomous offline browser control agent.
Your objective is to accomplish the user's task on the active webpage.

You are given:
1. USER GOAL: What the user wants to achieve.
2. CURRENT PAGE: Title and URL of the webpage.
3. INTERACTIVE ELEMENTS: A numbered list of visible interactive elements with badges [1], [2], etc.
4. ACTION HISTORY: Recent actions performed.

You MUST respond strictly with a valid JSON object matching this schema:
{
  "thought": "Your concise step-by-step reasoning about what element to interact with",
  "action": "click" | "fill" | "press" | "scroll" | "navigate" | "extract_text" | "done",
  "target": 1, // Number corresponding to the element badge [number], or null
  "value": "string value to type if action is fill",
  "key": "Enter" | "Tab" | "Escape", // Key to press if action is press or after fill
  "direction": "down" | "up", // If action is scroll
  "url": "https://...", // Target URL if action is navigate
  "speech": "Brief spoken sentence to say aloud to the user explaining this step or reporting completion"
}

RULES:
- When searching, prefer targeting the search input [badge] with "fill" and include key: "Enter".
- When goal is reached or user question answered, set action to "done" and provide the answer in "speech".
- Output ONLY the JSON object. Do not add markdown commentary outside the JSON.`;
  }

  /**
   * Checks if Chrome's native on-device Prompt API is available in this browser
   */
  async checkNativeAiAvailability() {
    try {
      const aiObj = (typeof ai !== 'undefined' && ai.languageModel) 
        ? ai.languageModel 
        : (typeof window !== 'undefined' && window.ai && window.ai.languageModel ? window.ai.languageModel : null);

      if (aiObj && typeof aiObj.capabilities === 'function') {
        const caps = await aiObj.capabilities();
        return caps.available === 'readily' || caps.available === 'after-download';
      }
    } catch (_) {}
    return false;
  }

  /**
   * Builds the formatted user turn prompt
   */
  formatPrompt(goal, pageState, history = []) {
    const elementsSummary = (pageState.elements || [])
      .map(el => `[${el.badge}] <${el.tag}${el.type ? ' type="' + el.type + '"' : ''}> "${el.text || el.placeholder || ''}"`)
      .join('\n');

    const historySummary = history.length > 0 
      ? history.map((h, i) => `${i + 1}. ${h.action} on [${h.target || 'page'}]: ${h.thought || ''}`).join('\n')
      : 'None yet (first step).';

    return `### USER GOAL:
${goal}

### CURRENT PAGE:
Title: ${pageState.title || 'Untitled'}
URL: ${pageState.url || 'about:blank'}

### ACTION HISTORY:
${historySummary}

### VISIBLE INTERACTIVE ELEMENTS (Set-of-Marks Badges):
${elementsSummary || 'No interactive elements detected on page.'}

Select the next action to advance toward the user goal:`;
  }

  /**
   * Parses model raw output into structured JSON tool call
   */
  parseToolCall(rawText) {
    if (!rawText) return null;
    const text = rawText.trim();

    try {
      return JSON.parse(text);
    } catch (_) {}

    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1].trim());
      } catch (_) {}
    }

    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(text.slice(firstBrace, lastBrace + 1));
      } catch (_) {}
    }

    return null;
  }

  /**
   * Executes inference turn
   */
  async planNextAction(goal, pageState, history = []) {
    const prompt = this.formatPrompt(goal, pageState, history);
    const startTime = performance.now();

    // 1. Try Chrome native Built-in on-device Prompt API (window.ai / ai.languageModel)
    try {
      const aiObj = (typeof ai !== 'undefined' && ai.languageModel) 
        ? ai.languageModel 
        : (typeof window !== 'undefined' && window.ai && window.ai.languageModel ? window.ai.languageModel : null);

      if (aiObj && typeof aiObj.create === 'function') {
        try {
          if (!this.session) {
            this.session = await aiObj.create({
              systemPrompt: this.systemPrompt,
              temperature: this.temperature
            });
          }

          const rawResponse = await this.session.prompt(prompt);
          const parsed = this.parseToolCall(rawResponse);
          const duration = Math.round(performance.now() - startTime);

          if (parsed) {
            return {
              action: parsed,
              rawOutput: rawResponse,
              source: 'gemma4_builtin_ai',
              durationMs: duration
            };
          }
        } catch (sessionErr) {
          console.warn('[Gemma4Runner] Prompt API session retry:', sessionErr.message);
          this.session = null; // Recreate fresh session on next turn
        }
      }
    } catch (nativeErr) {
      console.warn('[Gemma4Runner] Chrome native window.ai notice:', nativeErr.message);
      this.session = null;
    }

    // 2. Fallback to background service worker / offscreen engine
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'RUN_GEMMA_INFERENCE',
        prompt,
        systemPrompt: this.systemPrompt,
        temperature: this.temperature,
        maxTokens: this.maxTokens
      }, (response) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!response || !response.ok) {
          return reject(new Error(response?.error || 'Inference engine failed'));
        }

        resolve({
          action: response.action,
          rawOutput: response.rawOutput,
          source: response.source || 'embedded_engine',
          durationMs: response.durationMs || Math.round(performance.now() - startTime)
        });
      });
    });
  }
}

if (typeof window !== 'undefined') {
  window.Gemma4Runner = Gemma4Runner;
}
if (typeof module !== 'undefined') {
  module.exports = { Gemma4Runner };
}
