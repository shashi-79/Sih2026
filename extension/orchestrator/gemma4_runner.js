/**
 * Gemma 4 & Chrome Built-in AI (window.ai) Runner
 * LLM-First Autonomous Agent Engine: Sends prompts directly to the AI model
 * (Chrome Prompt API / Ollama / Local AI) so the model autonomously reasons
 * on the browser state rather than relying on brittle scripted rules or blind search fallbacks.
 */

class Gemma4Runner {
  constructor(options = {}) {
    this.modelName = options.modelName || 'chrome-builtin-window.ai';
    this.temperature = options.temperature || 0.2;
    this.maxTokens = options.maxTokens || 400;
    this.session = null;
    this.detectedBackend = 'none';
    this.preferredBackend = options.preferredBackend || 'ollama';
    this.ollamaUrl = (options.ollamaUrl || 'http://127.0.0.1:11434').replace('localhost', '127.0.0.1');

    this.systemPrompt = `You are a conversational AI browser copilot operating in the user's browser.
Your job is to accomplish the user's task step-by-step by observing interactive webpage elements and communicating naturally with the user.

TOOLS:
1. navigate: {"action": "navigate", "url": "https://..."}
2. click: {"action": "click", "target": <badge_number>}
3. fill: {"action": "fill", "target": <badge_number>, "value": "text to type", "key": "Enter"}
4. read_page: {"action": "read_page", "target": <optional_badge_or_null>}
5. scroll: {"action": "scroll", "direction": "down" | "up" | "bottom" | "top"}
6. press: {"action": "press", "key": "Enter" | "Escape" | "Tab"}
7. move_mouse: {"action": "move_mouse", "target": <badge_number>}
8. hover: {"action": "hover", "target": <badge_number>}
9. inject_script: {"action": "inject_script", "script": "document.title"}
10. done: {"action": "done", "speech": "Natural conversational completion message"}

CONVERSATIONAL VOICE RULES:
- "speech": MUST be an engaging, natural conversational message spoken to the user.
  - If the user spoke in Hindi or Hinglish, speak in natural conversational Hinglish/Hindi (e.g. "Ab main yeh link khol raha hoon...", "Aapke liye website open ho gayi hai!").
  - If the user spoke in English, speak in natural conversational English (e.g. "Opening this top article for you...", "Here is the website you requested!").
  - Do NOT output static robotic machine strings like "Searching for xyz" or "Action completed on the page". Be interactive and helpful!

CRITICAL RULES:
- Always respond strictly with a valid JSON object. No markdown text outside JSON.
- Output strictly a JSON object starting with { and ending with }. Do NOT output <think> tags.
- ANTI-REPETITION: NEVER output the same action and target that was already executed in ACTION HISTORY.
- INPUT HANDLING: NEVER use "click" on an <input> or <textarea> element. You MUST use "fill": {"action": "fill", "target": <badge>, "value": "<query>", "key": "Enter"}.
- SCROLL ACTION: If user wants to scroll or move the page (e.g. scroll down, scroll to bottom, scroll to top), output {"action": "scroll", "direction": "bottom"|"top"|"down"|"up"}. DO NOT click search result links or tutorials about scrolling! Once scrolled, output {"action": "done"}.
- SEARCH RESULTS PAGE: If on a search results page (Google/YouTube/Bing), DO NOT search or fill again. Click the first relevant search result link [badge] to open the website directly! But if user only asked to scroll, do NOT click articles.
- If the user's goal is NOT yet fulfilled, DO NOT choose "done". Use "fill", "read_page", or "click" on element badges to proceed.
- Only choose "done" when the user's final intent has been completely achieved.

JSON SCHEMA:
{"thought": "brief reason", "action": "click"|"fill"|"read_page"|"navigate"|"scroll"|"press"|"move_mouse"|"hover"|"inject_script"|"done", "target": 1, "value": "string", "script": "string", "key": "Enter", "speech": "Natural conversational update to user"}`;
  }

  /**
   * Retrieves the Chrome Prompt API languageModel object across namespaces
   */
  getAiLanguageModel() {
    if (typeof ai !== 'undefined' && ai.languageModel) return ai.languageModel;
    if (typeof window !== 'undefined' && window.ai && window.ai.languageModel) return window.ai.languageModel;
    if (typeof window !== 'undefined' && window.ai && window.ai.assistant) return window.ai.assistant;
    if (typeof self !== 'undefined' && self.ai && self.ai.languageModel) return self.ai.languageModel;
    if (typeof chrome !== 'undefined' && chrome.aiOriginTrial && chrome.aiOriginTrial.languageModel) return chrome.aiOriginTrial.languageModel;
    return null;
  }

  /**
   * Checks if Chrome Native Built-in AI or local LLM is available
   */
  async checkNativeAiAvailability() {
    // 1. Check Chrome Built-in Prompt API
    try {
      const aiModel = this.getAiLanguageModel();
      if (aiModel && typeof aiModel.capabilities === 'function') {
        const caps = await aiModel.capabilities();
        this.detectedBackend = 'chrome_ai';
        return {
          supported: true,
          status: caps.available, // 'readily' | 'after-download' | 'no'
          backend: 'Chrome Built-in AI (Prompt API)'
        };
      }
      if (typeof window !== 'undefined' && window.ai && typeof window.ai.canCreateTextSession === 'function') {
        const can = await window.ai.canCreateTextSession();
        this.detectedBackend = 'chrome_ai';
        return {
          supported: true,
          status: can === 'readily' ? 'readily' : (can === 'after-download' ? 'after-download' : 'no'),
          backend: 'Chrome Built-in AI (Legacy)'
        };
      }
    } catch (_) {}

    // 2. Check Localhost Ollama (uses Service Worker proxy to bypass extension CORS)
    try {
      const ollamaRes = await this.queryOllamaBridge('OLLAMA_TAGS');
      if (ollamaRes && ollamaRes.ok) {
        const models = ollamaRes.models || [];
        const modelName = models.find(m => /gemma4|gemma-4/i.test(m.name))?.name ||
                          models.find(m => /gemma/i.test(m.name))?.name ||
                          (models[0]?.name || 'gemma4:e2b');
        this.detectedBackend = 'ollama';
        return {
          supported: true,
          status: 'readily',
          backend: `Local Ollama (${modelName})`
        };
      }
    } catch (_) {}

    this.detectedBackend = 'none';
    return { supported: false, status: 'unavailable', backend: null };
  }

  /**
   * Initializes Prompt API session with fallback
   */
  async getPromptSession() {
    if (this.session) return this.session;

    const aiModel = this.getAiLanguageModel();
    if (aiModel) {
      try {
        if (typeof aiModel.create === 'function') {
          this.session = await aiModel.create({
            systemPrompt: this.systemPrompt,
            temperature: this.temperature
          });
          return this.session;
        }
      } catch (_) {
        try {
          this.session = await aiModel.create();
          return this.session;
        } catch (_) {}
      }
    }

    if (typeof window !== 'undefined' && window.ai && typeof window.ai.createTextSession === 'function') {
      try {
        this.session = await window.ai.createTextSession();
        return this.session;
      } catch (_) {}
    }

    return null;
  }

  /**
   * Phonetic Normalizer for Speech-to-Text variances in Indian English & Hinglish
   */
  normalizeVoicePhonetics(text) {
    if (!text || typeof text !== 'string') return '';
    let s = text.trim();
    // Common speech-to-text misrecognitions of "scroll" (/is-krol/ or /is-kaal/)
    s = s.replace(/\b(?:mis\s*call|miss\s*call|miscall|missed\s*call|as\s*called|has\s*called|us\s*called|is\s*crawl|is\s*call|ice\s*coal)\b/gi, 'scroll');
    // "page roll" / "roll karke" / "page ko roll" -> scroll
    s = s.replace(/\b(?:page\s+roll|roll\s+karke|page\s+ko\s+roll)\b/gi, 'scroll');
    // "cho scroll" / "cha scroll" / "to scroll" -> "ko scroll"
    s = s.replace(/\b(?:cho|cha)\s+scroll\b/gi, 'ko scroll');
    // "install the page" / "install page" (phonetic misrecognition of "scroll the page")
    s = s.replace(/\b(?:install|instal)\s+(?:the\s+)?page\b/gi, 'scroll the page');
    return s;
  }

  /**
   * Formats prompt with closed-loop agent context and anti-stagnation safeguards
   */
  formatPrompt(goal, pageState, history = [], isStagnant = false) {
    const rawElements = pageState.elements || [];
    // Prioritize actionable inputs, buttons, and relevant links
    const prioritized = rawElements.filter(el => {
      const tag = (el.tag || '').toLowerCase();
      return tag === 'input' || tag === 'button' || tag === 'textarea' || tag === 'select' || (tag === 'a' && el.text);
    });
    // Use up to 30 prioritized elements
    const elementsToUse = pageState.extractedContent
      ? (prioritized.length > 0 ? prioritized : rawElements).slice(0, 12)
      : (prioritized.length > 0 ? prioritized : rawElements).slice(0, 30);

    const elementsSummary = elementsToUse
      .map(el => `[${el.badge}] <${el.role || el.tag}${el.type ? ' type="' + el.type + '"' : ''}> "${(el.text || el.placeholder || el.value || '').substring(0, 60)}"`)
      .join('\n');

    const historySummary = history.length > 0 
      ? history.slice(-4).map((h, i) => `${i + 1}. Action: ${h.action} on [${h.target || h.url || 'page'}] -> ${h.outcome || 'Success'}`).join('\n')
      : 'None yet (first step).';

    const headingsText = (pageState.headings && pageState.headings.length > 0)
      ? `\n### PAGE HEADINGS / CONTEXT:\n` + pageState.headings.map(h => `- ${h}`).join('\n')
      : '';

    const alertsText = (pageState.alerts && pageState.alerts.length > 0)
      ? `\n### PAGE NOTICES / ALERTS:\n` + pageState.alerts.map(a => `⚠️ ${a}`).join('\n')
      : '';

    const extractedSection = pageState.extractedContent
      ? `\n### EXTRACTED PAGE TEXT (FROM READ_PAGE):\n${pageState.extractedContent.substring(0, 1500)}\n`
      : '';

    const stagnationWarning = isStagnant
      ? `\n### CRITICAL REPETITION WARNING:
The previous action did NOT progress the page! You are stuck in a loop.
DO NOT repeat the same action or click the same badge again.
Choose a DIFFERENT action, use "fill" to type text, scroll, or choose "read_page".\n`
      : '';

    return `### USER GOAL:
${goal}

### CURRENT WEBPAGE:
Title: ${pageState.title || 'Untitled'}
URL: ${pageState.url || 'about:blank'}${headingsText}${alertsText}

### ACTION HISTORY (LAST 4 STEPS):
${historySummary}
${stagnationWarning}
### VISIBLE INTERACTIVE ELEMENTS:
${elementsSummary || 'No interactive elements detected on active screen.'}
${extractedSection}
### INSTRUCTION:
Decide the next single action to advance toward the user's goal.
- If the user wants to SCROLL (scroll down, scroll to bottom, scroll to top), choose "scroll": {"action": "scroll", "direction": "bottom"|"top"|"down"|"up"}.
- NEVER repeat an action that already appeared in ACTION HISTORY with the same target.
- NEVER use "click" on an <input> or <textarea>. If you need to search or enter text, you MUST use "fill": {"action": "fill", "target": <badge_number>, "value": "text to type", "key": "Enter"}.
- If you need to read, inspect, or summarize page article content, use "read_page": {"action": "read_page"}.
- If page text is already extracted above and answers the user's goal, summarize it and choose "done": {"action": "done", "speech": "conversational summary"}.
- If you just navigated or opened the page, DO NOT choose "done" yet. Use "fill", "read_page", or "click" on the relevant element to continue progress.
- In "speech", speak a natural, friendly conversational update matching user language (Hindi/Hinglish or English).
Respond ONLY with a valid JSON object.`;
  }

  /**
   * Proxies Ollama requests through the background service worker or direct fetch
   * Guarantees non-blocking execution with strict timeouts so the UI never freezes.
   */
  async queryOllamaBridge(action, params = {}) {
    const targetUrl = (this.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '').replace('localhost', '127.0.0.1');

    // 1. Direct fetch first (runs from sidepanel window, immune to MV3 service worker timeouts)
    try {
      if (action === 'OLLAMA_TAGS') {
        const resp = await fetch(`${targetUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
        if (resp.ok) {
          const data = await resp.json();
          return { ok: true, models: data.models || [] };
        }
      } else if (action === 'OLLAMA_CHAT') {
        const resp = await fetch(`${targetUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
          signal: AbortSignal.timeout(90000)
        });
        if (resp.ok) {
          const data = await resp.json();
          return { ok: true, data };
        }
      }
    } catch (_) {}

    // 2. Extension Message Bridge fallback (if direct fetch blocked)
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        const timeoutMs = action === 'OLLAMA_CHAT' ? 90000 : 3500;
        const res = await new Promise((resolve) => {
          let resolved = false;
          const timer = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              resolve(null);
            }
          }, timeoutMs);

          try {
            chrome.runtime.sendMessage({
              action,
              url: targetUrl,
              ...params
            }, (response) => {
              if (resolved) return;
              resolved = true;
              clearTimeout(timer);
              if (chrome.runtime.lastError) {
                return resolve(null);
              }
              resolve(response);
            });
          } catch (_) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              resolve(null);
            }
          }
        });
        if (res && res.ok) return res;
      } catch (_) {}
    }

    return null;
  }

  /**
   * Queries local Ollama API with model caching and low-latency token prediction
   */
  async inferViaOllama(prompt, isStagnant = false) {
    try {
      if (!this._cachedModel) {
        const tagsRes = await this.queryOllamaBridge('OLLAMA_TAGS');
        if (tagsRes && tagsRes.ok && tagsRes.models) {
          const models = tagsRes.models;
          this._cachedModel = models.find(m => /gemma4|gemma-4/i.test(m.name))?.name ||
                              models.find(m => /gemma/i.test(m.name))?.name ||
                              (models[0]?.name || 'gemma4:e2b');
        } else {
          this._cachedModel = 'gemma4:e2b';
        }
      }
      const selectedModel = this._cachedModel;

      const chatRes = await this.queryOllamaBridge('OLLAMA_CHAT', {
        model: selectedModel,
        messages: [
          { role: 'system', content: this.systemPrompt },
          { role: 'user', content: prompt }
        ],
        stream: false,
        format: 'json',
        options: {
          temperature: isStagnant ? 0.45 : 0.1, // Break token determinism if previous action repeated
          num_predict: 420, // Sufficient token budget preventing premature truncation
          top_k: isStagnant ? 40 : 20,
          top_p: 0.9
        }
      });

      if (chatRes && chatRes.ok && chatRes.data) {
        const content = chatRes.data.message?.content || chatRes.data.response || '';
        const parsed = this.parseToolCall(content);
        if (parsed) {
          return {
            action: parsed,
            rawOutput: content,
            source: `Ollama (${selectedModel})`
          };
        } else if (content && content.trim().length > 0) {
          const trimmed = content.trim();
          // If content looks like broken/truncated JSON, salvage or reject - NEVER speak raw JSON
          const isJsonLike = trimmed.startsWith('\x7B') || trimmed.startsWith('\x5B') || /"(?:thought|action|speech|target)"/i.test(trimmed);
          if (isJsonLike) {
            const repaired = this.repairAndParseTruncatedJson(trimmed);
            if (repaired) {
              return {
                action: repaired,
                rawOutput: content,
                source: `Ollama (${selectedModel})`
              };
            }
            // Cannot extract valid action from truncated JSON, return null for planner fallback
            return null;
          }

          const cleanSpeech = content
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/<think>[\s\S]*$/gi, '')
            .replace(/^Thinking(?:\s+Process)?[\s\S]*?(?=(?:```|\x7B))/i, '')
            .replace(/[\x7B\x7D\x5B\x5D"]/g, '')
            .trim();

          if (cleanSpeech && cleanSpeech.length > 2 && !cleanSpeech.includes(':')) {
            return {
              action: {
                action: 'done',
                thought: cleanSpeech.substring(0, 150),
                speech: cleanSpeech.substring(0, 300) || 'Task completed.'
              },
              rawOutput: content,
              source: `Ollama (${selectedModel})`
            };
          }
          return null;
        }
      } else {
        // Clear cached model if inference failed or model was deleted
        this._cachedModel = null;
      }
    } catch (_) {
      this._cachedModel = null;
    }
    return null;
  }

  /**
   * Parses model raw output into structured JSON tool call
   */
  normalizeActionObject(obj) {
    if (!obj || typeof obj !== 'object') return null;

    let act = (obj.action || '').toLowerCase().trim();
    if (act === 'type' || act === 'write' || act === 'input') act = 'fill';
    if (act === 'search') {
      act = 'fill';
      if (!obj.key) obj.key = 'Enter';
    }
    if (act === 'enter' || act === 'keypress') act = 'press';
    if (act === 'read' || act === 'read_article' || act === 'extract_text' || act === 'readpage') act = 'read_page';
    if (act === 'mouse_move' || act === 'mousemove' || act === 'cursor_move' || act === 'move_cursor' || act === 'pointer_move') act = 'move_mouse';
    if (act === 'mouse_hover' || act === 'mousehover') act = 'hover';
    if (act === 'inject_script' || act === 'execute_script' || act === 'run_script' || act === 'eval' || act === 'eval_script' || act === 'script') {
      act = 'inject_script';
      if (!obj.script) obj.script = obj.code || obj.value || obj.content || '';
    }

    // If model outputs 'navigate' with a target badge and NO standalone http URL, convert to 'click'
    if (act === 'navigate' && obj.target !== undefined && obj.target !== null && (!obj.url || !/^https?:\/\//i.test(String(obj.url)))) {
      act = 'click';
    }

    if (obj.value === undefined) {
      obj.value = obj.text !== undefined ? obj.text : (obj.query !== undefined ? obj.query : (obj.content !== undefined ? obj.content : (obj.input !== undefined ? obj.input : '')));
    }

    // If model outputs 'click' with text content, convert to 'fill'
    if (act === 'click' && obj.value && String(obj.value).trim().length > 0) {
      act = 'fill';
      if (!obj.key) obj.key = 'Enter';
    }

    if (act === 'fill' && !obj.key) {
      obj.key = 'Enter';
    }

    if (act === 'scroll' && !obj.direction) {
      const combined = `${obj.thought || ''} ${obj.speech || ''} ${obj.value || ''}`.toLowerCase();
      if (/\b(?:bottom|niche|neeche|end|last)\b/.test(combined)) obj.direction = 'bottom';
      else if (/\b(?:top|upar|ooper|shuru|start)\b/.test(combined)) obj.direction = 'top';
      else if (/\b(?:up)\b/.test(combined)) obj.direction = 'up';
      else obj.direction = 'down';
    }

    obj.action = act;

    if (obj.target === undefined) {
      obj.target = obj.element !== undefined ? obj.element : (obj.badge !== undefined ? obj.badge : (obj.id !== undefined ? obj.id : null));
    }
    if (typeof obj.target === 'string') {
      const digits = obj.target.replace(/[^0-9]/g, '');
      if (digits) {
        obj.target = parseInt(digits, 10);
      }
    }

    if (!obj.action) return null;
    return obj;
  }

  /**
   * Resiliently repairs and parses truncated or unclosed JSON tool calls
   */
  repairAndParseTruncatedJson(rawText) {
    if (!rawText) return null;
    let text = rawText
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<think>[\s\S]*$/gi, '')
      .replace(/^Thinking(?:\s+Process)?[\s\S]*?(?=(?:```|\x7B))/i, '')
      .trim();

    // 1. Direct Regex extraction of structured tool fields even from unclosed JSON
    const actionMatch = text.match(/"action"\s*:\s*"([a-zA-Z0-9_-]+)"/i);
    if (actionMatch) {
      const act = actionMatch[1].toLowerCase().trim();
      const targetMatch = text.match(/"(?:target|badge|element|id)"\s*:\s*(\d+|"[^"]*")/i);
      const valMatch = text.match(/"(?:value|text|query|content|input)"\s*:\s*"([^"\r\n]*)/i);
      const dirMatch = text.match(/"direction"\s*:\s*"([a-zA-Z]+)"/i);
      const speechMatch = text.match(/"speech"\s*:\s*"([^"\r\n]*)/i);
      const thoughtMatch = text.match(/"thought"\s*:\s*"([^"\r\n]*)/i);

      let targetVal = null;
      if (targetMatch) {
        const rawT = targetMatch[1].replace(/["']/g, '');
        const digits = rawT.replace(/[^0-9]/g, '');
        targetVal = digits ? parseInt(digits, 10) : rawT;
      }

      const obj = {
        action: act,
        target: targetVal,
        value: valMatch ? valMatch[1] : undefined,
        direction: dirMatch ? dirMatch[1] : undefined,
        speech: speechMatch ? speechMatch[1] : undefined,
        thought: thoughtMatch ? thoughtMatch[1] : undefined
      };
      const normalized = this.normalizeActionObject(obj);
      if (normalized) return normalized;
    }

    // 2. Syntax Repair by auto-balancing quotes and braces
    const firstBrace = text.indexOf('\x7B');
    if (firstBrace !== -1) {
      let candidate = text.substring(firstBrace);
      candidate = candidate.replace(/,\s*$/, '');
      const quoteCount = (candidate.match(/(?<!\\)"/g) || []).length;
      if (quoteCount % 2 !== 0) {
        candidate += '"';
      }
      const openCount = (candidate.match(/[\x7B]/g) || []).length;
      const closeCount = (candidate.match(/[\x7D]/g) || []).length;
      for (let i = closeCount; i < openCount; i++) {
        candidate += '\x7D';
      }
      try {
        const obj = JSON.parse(candidate);
        const normalized = this.normalizeActionObject(obj);
        if (normalized) return normalized;
      } catch (_) {}
    }

    return null;
  }

  /**
   * Parses model raw output into structured JSON tool call
   */
  parseToolCall(rawText) {
    if (!rawText) return null;
    const text = rawText.trim();

    // 0. Strip <think>...</think> reasoning traces emitted by thinking/reasoning models
    let cleanText = text
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<think>[\s\S]*$/gi, '')
      .replace(/^Thinking(?:\s+Process)?[\s\S]*?(?=(?:```|\x7B))/i, '')
      .trim();

    if (!cleanText) {
      cleanText = text.replace(/<think>|<\/think>/gi, '').trim();
    }

    // 1. Direct JSON parse
    try {
      const obj = JSON.parse(cleanText);
      const normalized = this.normalizeActionObject(obj);
      if (normalized) return normalized;
    } catch (_) {}

    // 2. Extract JSON code block ```json ... ```
    const jsonMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        const obj = JSON.parse(jsonMatch[1].trim());
        const normalized = this.normalizeActionObject(obj);
        if (normalized) return normalized;
      } catch (_) {}
    }

    // 3. Extract JSON object within { ... }
    const firstBrace = cleanText.indexOf('{');
    const lastBrace = cleanText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        const obj = JSON.parse(cleanText.slice(firstBrace, lastBrace + 1));
        const normalized = this.normalizeActionObject(obj);
        if (normalized) return normalized;
      } catch (_) {}
    }

    // Fallback: check original text if cleanText had no braces
    if (firstBrace === -1) {
      const fb = text.lastIndexOf('{');
      const lb = text.lastIndexOf('}');
      if (fb !== -1 && lb !== -1 && lb > fb) {
        try {
          const obj = JSON.parse(text.slice(fb, lb + 1));
          const normalized = this.normalizeActionObject(obj);
          if (normalized) return normalized;
        } catch (_) {}
      }
    }

    // 3B. Truncated / Unclosed JSON repair
    const repaired = this.repairAndParseTruncatedJson(cleanText);
    if (repaired) return repaired;

    // 4. NLP Intent Extraction (if LLM returned plain text description)
    const lower = cleanText.toLowerCase();
    const urlMatch = text.match(/https?:\/\/[^\s"'<>]+/i);
    if (urlMatch) {
      return {
        thought: text.substring(0, 100),
        action: 'navigate',
        url: urlMatch[0],
        speech: `Navigating to ${urlMatch[0]}.`
      };
    }

    if (lower.includes('scroll to bottom') || lower.includes('scroll the page to bottom') || lower.includes('to bottom') || lower.includes('sabse neeche') || lower.includes('bottom tak')) {
      return { thought: text.substring(0, 100), action: 'scroll', direction: 'bottom', speech: 'Page ko neeche bottom tak scroll kar raha hoon.' };
    }
    if (lower.includes('scroll to top') || lower.includes('scroll the page to top') || lower.includes('to top') || lower.includes('sabse upar') || lower.includes('top mein')) {
      return { thought: text.substring(0, 100), action: 'scroll', direction: 'top', speech: 'Page ko sabse upar scroll kar raha hoon.' };
    }
    if (lower.includes('scroll down') || lower.includes('scroll') || lower.includes('roll') || lower.includes('neeche') || lower.includes('niche')) {
      return { thought: text.substring(0, 100), action: 'scroll', direction: 'down', speech: 'Main page ko neeche scroll kar raha hoon.' };
    }
    if (lower.includes('scroll up') || lower.includes('upar') || lower.includes('ooper')) {
      return { thought: text.substring(0, 100), action: 'scroll', direction: 'up', speech: 'Page ko upar scroll kar raha hoon.' };
    }

    if (lower.includes('read page') || lower.includes('read the page') || lower.includes('read article') || lower.includes('summarize page') || lower.includes('extract text')) {
      return {
        thought: 'Extract and read page text content',
        action: 'read_page',
        speech: 'Reading the content of this page.'
      };
    }

    // 4A. Compound click-and-type intent: "click [1] and type songs", "click 1 and search songs"
    const clickAndType = text.match(/click\s*(?:on\s*)?\[?(\d+)\]?\s*(?:and|,|then)\s*(?:type|fill|write|enter|search)\s+["']?([^"'\r\n]+?)["']?$/i);
    if (clickAndType) {
      const badge = parseInt(clickAndType[1], 10);
      const val = clickAndType[2].trim();
      return {
        thought: text.substring(0, 100),
        action: 'fill',
        target: badge,
        value: val,
        key: 'Enter',
        speech: `Typing "${val}".`
      };
    }

    // 4B. "fill/type [1] with <text>" (with or without quotes)
    const fillWith = text.match(/(?:fill|type|write|enter)\s+\[?(\d+)\]?\s+(?:with\s+)?["']?([^"'\r\n]+?)["']?$/i);
    if (fillWith) {
      const badge = parseInt(fillWith[1], 10);
      const val = fillWith[2].trim();
      return {
        thought: text.substring(0, 100),
        action: 'fill',
        target: badge,
        value: val,
        key: 'Enter',
        speech: `Typing "${val}".`
      };
    }

    // 4C. "type/fill <text> into/in/on [1]" (with or without quotes)
    const typeInto = text.match(/(?:fill|type|write|enter)\s+["']?([^"'\r\n]+?)["']?\s+(?:into|in|on)\s+\[?(\d+)\]?$/i);
    if (typeInto) {
      const val = typeInto[1].trim();
      const badge = parseInt(typeInto[2], 10);
      return {
        thought: text.substring(0, 100),
        action: 'fill',
        target: badge,
        value: val,
        key: 'Enter',
        speech: `Typing "${val}".`
      };
    }

    // 4D. "search for <text>" or "search <text>"
    const searchMatch = text.match(/(?:search(?:\s+for)?)\s+["']?([^"'\n\r]+)["']?/i);
    if (searchMatch && !lower.includes('done') && !lower.includes('finished')) {
      const q = searchMatch[1].replace(/on google|on youtube|on wikipedia/i, '').trim();
      return {
        thought: text.substring(0, 100),
        action: 'fill',
        target: null,
        value: q,
        key: 'Enter',
        speech: `Searching for "${q}".`
      };
    }

    // 4E. General fill / type with quotes
    const fillMatch = text.match(/(?:fill|type|enter|write)\s+(?:\[?(\d+)\]?\s+with\s+)?["']([^"']+)["']/i) ||
                      text.match(/(?:fill|type|enter|write)\s+["']([^"']+)["']\s+(?:into|in|on)\s+\[?(\d+)\]?/i);
    if (fillMatch) {
      const badgeCandidate = fillMatch[1] && /^\d+$/.test(fillMatch[1]) ? parseInt(fillMatch[1], 10) : (fillMatch[3] && /^\d+$/.test(fillMatch[3]) ? parseInt(fillMatch[3], 10) : null);
      const val = fillMatch[2] || fillMatch[1];
      return {
        thought: text.substring(0, 100),
        action: 'fill',
        target: badgeCandidate,
        value: val,
        key: 'Enter',
        speech: `Typing "${val}".`
      };
    }

    // 4F. Bare click: ONLY if no typing, filling, or explicit search query instruction is present
    const clickNum = text.match(/click.*?\[?(\d+)\]?/i);
    if (clickNum && !/type|fill|write|search\s+for|search\s+["']|move|hover/i.test(text)) {
      const badge = parseInt(clickNum[1], 10);
      return { thought: text.substring(0, 100), action: 'click', target: badge, speech: `Clicking element [${badge}].` };
    }

    // 4G. Move mouse or hover: "move mouse to [badge]", "hover [badge]", "cursor move to [badge]"
    const mouseMoveMatch = text.match(/(?:move\s+(?:mouse|cursor)|point(?:\s+to)?|hover(?:\s+on|\s+over)?)\s+(?:to\s+)?\[?(\d+)\]?/i);
    if (mouseMoveMatch) {
      const badge = parseInt(mouseMoveMatch[1], 10);
      const isHover = /hover/i.test(text);
      return {
        thought: text.substring(0, 100),
        action: isHover ? 'hover' : 'move_mouse',
        target: badge,
        speech: isHover ? `Hovering over element [${badge}].` : `Moving cursor to element [${badge}].`
      };
    }

    // 4H. Script injection: "inject script <code>", "run script <code>", "execute script <code>"
    const scriptMatch = text.match(/(?:inject(?:\s+script)?|execute(?:\s+script)?|run\s+script|eval)\s+[:=]?\s*(?:```(?:javascript|js)?\s*)?([\s\S]+?)(?:```)?$/i);
    if (scriptMatch && !lower.includes('done') && !lower.includes('finished')) {
      const code = scriptMatch[1].trim();
      return {
        thought: text.substring(0, 100),
        action: 'inject_script',
        script: code,
        speech: 'Injecting custom script into website.'
      };
    }

    if (lower.includes('done') || lower.includes('finished') || lower.includes('completed')) {
      return { thought: text.substring(0, 100), action: 'done', speech: text.substring(0, 120) };
    }

    return null;
  }

  /**
   * Queries In-Browser WebGPU Offscreen Worker
   */
  async queryWebGPUWorker(prompt) {
    return new Promise((resolve) => {
      let done = false;
      const to = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 7000);
      try {
        chrome.runtime.sendMessage({
          target: 'offscreen',
          action: 'INFER',
          prompt: prompt,
          systemPrompt: this.systemPrompt,
          temperature: this.temperature
        }, (resp) => {
          if (done) return;
          done = true;
          clearTimeout(to);
          if (chrome.runtime.lastError) {
            const _ = chrome.runtime.lastError.message;
            return resolve(null);
          }
          if (resp && resp.ok && resp.action) {
            return resolve(resp);
          }
          resolve(null);
        });
      } catch (_) {
        if (!done) { done = true; clearTimeout(to); resolve(null); }
      }
    });
  }

  /**
   * LLM-First Action Planner
   * Multi-backend execution: Queries user's preferred backend (WebGPU / Chrome AI / Ollama),
   * with automatic fallback and zero external cloud dependencies.
   */
  async planNextAction(goal, pageState, history = [], isStagnant = false) {
    const prompt = this.formatPrompt(goal, pageState, history, isStagnant);
    const startTime = performance.now();

    // 1. If preferred is WebGPU, dispatch to WebGPU offscreen worker FIRST
    if (this.preferredBackend === 'webgpu') {
      const webgpuResult = await this.queryWebGPUWorker(prompt);
      if (webgpuResult && webgpuResult.action) {
        webgpuResult.durationMs = Math.round(performance.now() - startTime);
        return webgpuResult;
      }
    }

    // 2. If preferred is Chrome Built-in AI, query Prompt API FIRST
    if (this.preferredBackend === 'chrome_ai') {
      try {
        const session = await this.getPromptSession();
        if (session && typeof session.prompt === 'function') {
          const rawResponse = await session.prompt(prompt);
          const parsed = this.parseToolCall(rawResponse);
          if (parsed) {
            return {
              action: parsed,
              rawOutput: rawResponse,
              source: 'Chrome Built-in AI',
              durationMs: Math.round(performance.now() - startTime)
            };
          }
        }
      } catch (err) {
        console.warn('[Gemma4Runner] Chrome Built-in AI prompt notice:', err.message);
        this.session = null;
      }
    }

    // 3. Localhost Ollama (default or fallback)
    if (!this.preferredBackend || this.preferredBackend === 'ollama' || this.preferredBackend === 'chrome_ai') {
      const ollamaResult = await this.inferViaOllama(prompt, isStagnant);
      if (ollamaResult) {
        ollamaResult.durationMs = Math.round(performance.now() - startTime);
        return ollamaResult;
      }
    }

    // 4. In-Browser WebGPU fallback (if not preferred, but others failed)
    if (this.preferredBackend !== 'webgpu') {
      const webgpuFallback = await this.queryWebGPUWorker(prompt);
      if (webgpuFallback && webgpuFallback.action) {
        webgpuFallback.durationMs = Math.round(performance.now() - startTime);
        return webgpuFallback;
      }
    }

    return {
      action: {
        action: 'done',
        speech: 'Local AI models did not respond in time. Please check your selected engine status in settings.'
      },
      rawOutput: '{"error": "Offline models unavailable"}',
      source: 'model_offline',
      durationMs: Math.round(performance.now() - startTime)
    };
  }

  /**
   * Phase 1: Pure AI Semantic Intent & Conversational Response
   * Replaces brittle regexes with true LLM comprehension in English, Hindi, and Hinglish.
   */
  async extractIntentAndConversation(goalText) {
    if (!goalText || !goalText.trim()) {
      return {
        conversational_reply: 'Hello! How can I assist your browsing today?',
        search_query: '',
        direct_url: null,
        intent: 'inspect',
        direction: null
      };
    }

    const cleanGoal = this.normalizeVoicePhonetics(goalText);
    const isHindi = /[^\u0000-\u007F]|khol|batao|dekha|chutkule|vyavsay|chalao|gaana|karo|le\s+jao|sabse\s+upar|niche|neeche/i.test(cleanGoal);

    // Fast-path for direct page actions (scroll, read, script) to guarantee immediate execution without search confusion
    const isScrollGoal = /\b(?:scroll|bottom|top|niche|neeche|upar|ooper)\b/i.test(cleanGoal) &&
                         !/\b(?:how\s+to|what\s+is|meaning|definition|tutorial|video|song|code)\b/i.test(cleanGoal);

    if (isScrollGoal) {
      let dir = 'down';
      if (/\b(?:bottom|niche|neeche|end|last)\b/i.test(cleanGoal)) dir = 'bottom';
      else if (/\b(?:top|upar|ooper|shuru|start)\b/i.test(cleanGoal)) dir = 'top';
      else if (/\b(?:up)\b/i.test(cleanGoal)) dir = 'up';

      let scrollReply = '';
      if (dir === 'top') {
        scrollReply = isHindi ? 'Page ko sabse upar scroll kar raha hoon.' : 'Scrolling to the top of the page for you.';
      } else if (dir === 'bottom') {
        scrollReply = isHindi ? 'Page ko neeche bottom tak scroll kar raha hoon.' : 'Scrolling the page to the bottom for you.';
      } else {
        scrollReply = isHindi ? 'Page scroll kar raha hoon.' : 'Scrolling the page for you.';
      }

      return {
        conversational_reply: scrollReply,
        search_query: '',
        direct_url: null,
        intent: 'scroll',
        direction: dir
      };
    }

    const intentPrompt = `You are an intelligent, friendly AI browser assistant.
Analyze the user's voice command and return a valid JSON object.
USER COMMAND: "${cleanGoal.trim()}"

RULES:
1. "conversational_reply": Speak directly to the user in a warm, interactive, human conversational tone.
   - If user spoke in Hindi or Hinglish, reply in natural, friendly Hinglish (e.g. "Haan, main aapke liye majedar business jokes dhoondh raha hoon...", "Sure, chaliye main aapke liye website kholta hoon!").
   - If user spoke in English, reply in friendly conversational English (e.g. "Sure! Let me find that for you right away.").
2. "search_query": The clean topic or keywords to search (e.g. if user said "majedar vyavsay kholo chutkule Ho", search_query is "majedar vyavsay chutkule"). Remove conversational filler like "hello", "kholo", "search karo", "dikhao", "batao", "please". Leave empty if intent is scroll or read.
3. "direct_url": If the user explicitly requested a specific website (like "wikipedia.org", "youtube.com"), provide the full URL (e.g. "https://www.wikipedia.org"), otherwise null.
4. "intent": "scroll" | "search" | "navigate" | "read_page" | "inject_script"
5. "direction": "bottom" | "top" | "down" | "up" (only if intent is scroll, otherwise null)

Respond strictly with a JSON object:
{"conversational_reply": "string", "search_query": "string", "direct_url": null, "intent": "search", "direction": null}`;

    try {
      // 1. Try Ollama (Fast low-token prediction)
      if (!this.preferredBackend || this.preferredBackend === 'ollama') {
        if (!this._cachedModel) {
          const tagsRes = await this.queryOllamaBridge('OLLAMA_TAGS');
          if (tagsRes && tagsRes.ok && tagsRes.models) {
            const models = tagsRes.models;
            this._cachedModel = models.find(m => /gemma4|gemma-4/i.test(m.name))?.name ||
                                models.find(m => /gemma/i.test(m.name))?.name ||
                                (models[0]?.name || 'gemma4:e2b');
          } else {
            this._cachedModel = 'gemma4:e2b';
          }
        }

        const chatRes = await this.queryOllamaBridge('OLLAMA_CHAT', {
          model: this._cachedModel,
          messages: [
            { role: 'system', content: 'You are an AI assistant that analyzes user browser commands and outputs strict JSON.' },
            { role: 'user', content: intentPrompt }
          ],
          stream: false,
          format: 'json',
          options: {
            temperature: 0.2,
            num_predict: 120,
            top_k: 20
          }
        });

        if (chatRes && chatRes.ok && chatRes.data) {
          const content = chatRes.data.message?.content || chatRes.data.response || '';
          const parsed = this.parseJsonSafely(content);
          if (parsed && (parsed.conversational_reply || parsed.search_query || parsed.intent)) {
            return {
              conversational_reply: parsed.conversational_reply || `Got it! Working on: "${cleanGoal}".`,
              search_query: parsed.search_query || (parsed.intent === 'search' ? cleanGoal.trim() : ''),
              direct_url: parsed.direct_url || null,
              intent: parsed.intent || (parsed.direct_url ? 'navigate' : 'search'),
              direction: parsed.direction || null
            };
          }
        }
      }

      // 2. Try Chrome Built-in AI if available
      const session = await this.getPromptSession();
      if (session && typeof session.prompt === 'function') {
        const rawRes = await session.prompt(intentPrompt);
        const parsed = this.parseJsonSafely(rawRes);
        if (parsed && (parsed.conversational_reply || parsed.search_query || parsed.intent)) {
          return {
            conversational_reply: parsed.conversational_reply || `Got it! Working on: "${cleanGoal}".`,
            search_query: parsed.search_query || (parsed.intent === 'search' ? cleanGoal.trim() : ''),
            direct_url: parsed.direct_url || null,
            intent: parsed.intent || (parsed.direct_url ? 'navigate' : 'search'),
            direction: parsed.direction || null
          };
        }
      }
    } catch (_) {}

    // Fallback: Clean conversational response without brittle regex
    const isClick = /click|dabao|chuno/i.test(cleanGoal);
    const isScript = /script|inject|code|eval/i.test(cleanGoal);

    let reply = isHindi ? `Haan, main aapke liye "${cleanGoal}" dhoondhta hoon.` : `Got it! Let me search for "${cleanGoal}".`;
    let fallbackIntent = 'search';

    if (isClick) {
      reply = isHindi ? `Theek hai, main click kar raha hoon.` : `Sure, clicking that for you.`;
      fallbackIntent = 'click';
    } else if (isScript) {
      reply = isHindi ? `Page par script execute kar raha hoon.` : `Executing script on the page.`;
      fallbackIntent = 'inject_script';
    }

    return {
      conversational_reply: reply,
      search_query: fallbackIntent === 'search' ? cleanGoal.trim() : '',
      direct_url: null,
      intent: fallbackIntent,
      direction: null
    };
  }

  /**
   * Helper to safely extract JSON from model response
   */
  parseJsonSafely(rawText) {
    if (!rawText) return null;
    const clean = rawText
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<think>[\s\S]*$/gi, '')
      .trim();
    try {
      return JSON.parse(clean);
    } catch (_) {}
    const fb = clean.indexOf('{');
    const lb = clean.lastIndexOf('}');
    if (fb !== -1 && lb > fb) {
      try {
        return JSON.parse(clean.slice(fb, lb + 1));
      } catch (_) {}
    }
    return null;
  }
}

if (typeof window !== 'undefined') {
  window.Gemma4Runner = Gemma4Runner;
}
if (typeof module !== 'undefined') {
  module.exports = { Gemma4Runner };
}
