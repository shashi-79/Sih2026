/**
 * Agent Controller: Closed-Loop Autonomous Browser Coordinator
 * Implements Loop Engineering: Observe -> Evaluate -> Think -> Act -> Reflect -> Verify -> Loop.
 * Continuously drives multi-step tasks to convergence without requiring manual prompting.
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
    this.maxSteps = Infinity; // No artificial limit - autonomous continuous closed-loop until complete
    this.currentStep = 0;
    this.lastExtractedText = '';
    this.targetTabId = null;
    this.consecutiveRepeats = 0;
    this.lastActionSignature = '';
    this.urlStagnationCount = 0;
    this.lastObservedUrl = '';
    this.searchPerformed = false;
    this.hasOpenedSearchResult = false;
    this.lastSpokenText = '';
    this.currentSemanticIntent = null;
    this.attemptedBadges = new Set();
    this.milestones = [];
    this.currentMilestoneIndex = 0;
    this.useCdp = true;
  }

  /**
   * Decomposes user's natural language goal into progressive milestones
   */
  decomposeGoalIntoMilestones(goalText) {
    const cleanGoal = (goalText || '').trim();
    const milestones = [];

    const domainMatch = cleanGoal.match(/\b([a-zA-Z0-9-]+\.(?:com|org|net|io|in|edu|gov|co|ai))\b/i);
    const hasSearchKeyword = /\b(?:search|find|google|look\s*up|dhoondo)\b/i.test(cleanGoal);
    const hasFillKeyword = /\b(?:fill|type|submit|login|register|signup|enter)\b/i.test(cleanGoal);
    const hasScrollKeyword = /\b(?:scroll|bottom|top|niche|upar)\b/i.test(cleanGoal);

    if (hasScrollKeyword) {
      milestones.push({ id: 1, title: 'Observe page viewport', status: 'in_progress' });
      milestones.push({ id: 2, title: 'Execute requested scroll movement', status: 'pending' });
    } else if (domainMatch) {
      const domain = domainMatch[1];
      milestones.push({ id: 1, title: `Navigate to ${domain}`, status: 'in_progress' });
      milestones.push({ id: 2, title: 'Locate target interactive elements', status: 'pending' });
      milestones.push({ id: 3, title: 'Complete user requested actions', status: 'pending' });
    } else if (hasFillKeyword) {
      milestones.push({ id: 1, title: 'Identify form inputs and fields', status: 'in_progress' });
      milestones.push({ id: 2, title: 'Fill required data and values', status: 'pending' });
      milestones.push({ id: 3, title: 'Submit and verify confirmation', status: 'pending' });
    } else if (hasSearchKeyword) {
      milestones.push({ id: 1, title: 'Execute search query', status: 'in_progress' });
      milestones.push({ id: 2, title: 'Inspect search results and select matching link', status: 'pending' });
      milestones.push({ id: 3, title: 'Extract requested content / satisfy goal', status: 'pending' });
    } else {
      milestones.push({ id: 1, title: 'Observe active page state', status: 'in_progress' });
      milestones.push({ id: 2, title: 'Interact with target elements', status: 'pending' });
      milestones.push({ id: 3, title: 'Verify task completion', status: 'pending' });
    }

    this.milestones = milestones;
    this.currentMilestoneIndex = 0;
    this.bus.emit('MILESTONES_UPDATED', { milestones: this.milestones });
    return milestones;
  }

  /**
   * AI-First Query Resolver: Returns the AI-extracted semantic query,
   * completely free of brittle hardcoded regex replacements.
   */
  extractSearchQuery(goalText) {
    if (this.currentSemanticIntent && this.currentSemanticIntent.search_query) {
      return this.currentSemanticIntent.search_query;
    }
    return (goalText || '').trim();
  }

  /**
   * Identifies top organic search result element on Google, YouTube, Bing, or DuckDuckGo
   */
  findTopSearchResult(elements, currentUrl, excludeBadges = null) {
    if (!elements || elements.length === 0) return null;

    const isGoogle = /google\.[a-z.]+\/search/i.test(currentUrl);
    const isYouTube = /youtube\.com\/results/i.test(currentUrl);
    const isBing = /bing\.com\/search/i.test(currentUrl);
    const isDuck = /duckduckgo\.com/i.test(currentUrl);

    // 1. YouTube specific: look for /watch?v= video links
    if (isYouTube) {
      for (const el of elements) {
        if (excludeBadges && (excludeBadges.has(el.badge) || excludeBadges.has(String(el.badge)))) continue;
        const href = (el.href || '').trim();
        const text = (el.text || '').trim();
        if (href.includes('/watch?v=') || (el.tag === 'a' && text.length > 5 && !/^(home|shorts|subscriptions|history|you|library)$/i.test(text))) {
          return el;
        }
      }
    }

    // 2. Google / Bing / DuckDuckGo search results
    const ignoreTexts = /^(all|images|videos|news|maps|shopping|books|finance|search|tools|sign in|settings|quick settings|privacy|terms|help|feedback|next|previous|more results|verbatim|people also ask|filters|clear|google apps)$/i;
    const ignoreHrefs = /google\.[a-z.]+\/(search|preferences|advanced_search|intl(?!\/url)|policies|accounts)|accounts\.google|support\.google|maps\.google/i;
    const ignoreAdPhrases = /opens in new tab|about this result|sponsored|ad\b|advertisement|feedback|cached|similar/i;

    const unwrapHref = (raw) => {
      if (!raw) return '';
      if (raw.includes('/url?') || raw.includes('url=http') || raw.includes('q=http')) {
        try {
          const u = new URL(raw, 'https://www.google.com');
          const dest = u.searchParams.get('url') || u.searchParams.get('q');
          if (dest) {
            const dec = decodeURIComponent(dest);
            if (/^https?:\/\//i.test(dec)) return dec;
          }
        } catch (_) {}
      }
      return raw;
    };

    for (const el of elements) {
      if (!el) continue;
      if (excludeBadges && (excludeBadges.has(el.badge) || excludeBadges.has(String(el.badge)))) continue;
      const tag = (el.tag || '').toLowerCase();
      let href = (el.href || '').trim();
      const text = (el.text || '').trim();

      if (tag !== 'a' && el.role !== 'link') continue;
      if (!text || text.length < 5) continue;
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
      if (ignoreAdPhrases.test(text)) continue;

      const cleanHref = unwrapHref(href);
      if (cleanHref !== href) el.href = cleanHref;

      if (isGoogle) {
        if (ignoreHrefs.test(cleanHref)) continue;
        if (ignoreTexts.test(text)) continue;
        if (text.length >= 8 && !/google/i.test(text) && /^https?:\/\//i.test(cleanHref)) {
          return el;
        }
      } else if (isBing) {
        if (/bing\.com\/(search|images|videos)/i.test(cleanHref)) continue;
        if (!ignoreTexts.test(text) && text.length >= 8) return el;
      } else if (isDuck) {
        if (/duckduckgo\.com\//i.test(cleanHref)) continue;
        if (!ignoreTexts.test(text) && text.length >= 8) return el;
      }
    }

    // Fallback: any link with substantial text that isn't a search engine control or ad label
    for (const el of elements) {
      if (!el) continue;
      if (excludeBadges && (excludeBadges.has(el.badge) || excludeBadges.has(String(el.badge)))) continue;
      const tag = (el.tag || '').toLowerCase();
      const text = (el.text || '').trim();
      const href = (el.href || '').trim();
      const cleanHref = unwrapHref(href);
      if (cleanHref !== href) el.href = cleanHref;

      if ((tag === 'a' || el.role === 'link') && text.length >= 10 && !/google|bing|duckduckgo/i.test(text) && !ignoreHrefs.test(cleanHref) && !ignoreAdPhrases.test(text) && /^https?:\/\//i.test(cleanHref)) {
        return el;
      }
    }

    return null;
  }

  /**
   * Starts closed-loop autonomous execution toward a user goal
   */
  async executeGoal(goalText) {
    const rawGoal = (goalText || '').trim();
    if (!rawGoal) return { ok: false, error: 'Empty goal' };

    const normalizedGoal = (this.runner && typeof this.runner.normalizeVoicePhonetics === 'function')
      ? this.runner.normalizeVoicePhonetics(rawGoal)
      : rawGoal;

    if (this.isRunning) {
      console.warn('[AgentController] Terminating prior task to start new goal.');
      await this.stop();
    }

    this.isRunning = true;
    this.isPaused = false;
    this.currentGoal = normalizedGoal;
    this.actionHistory = [];
    this.currentStep = 0;
    this.lastExtractedText = '';
    this.consecutiveRepeats = 0;
    this.lastActionSignature = '';
    this.urlStagnationCount = 0;
    this.lastObservedUrl = '';
    this.searchPerformed = false;
    this.hasOpenedSearchResult = false;
    this.lastSpokenText = '';
    this.attemptedBadges = new Set();
    this.stagnationInterventions = 0;

    // Bind current active tab to ensure all actions target the correct tab
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      try {
        const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTabs && activeTabs.length > 0 && activeTabs[0].id) {
          this.targetTabId = activeTabs[0].id;
        }
      } catch (_) {}
    }

    // Phase 0: Milestone Decomposition for Autonomous Execution
    this.decomposeGoalIntoMilestones(this.currentGoal);

    this.bus.emit('WORKFLOW_STARTED', { goal: this.currentGoal });

    // Phase 1: Pure AI Semantic Intent & Conversational Initial Reply
    let semanticIntent = null;
    if (this.runner && typeof this.runner.extractIntentAndConversation === 'function') {
      try {
        semanticIntent = await this.runner.extractIntentAndConversation(this.currentGoal);
      } catch (_) {}
    }
    this.currentSemanticIntent = semanticIntent || {
      conversational_reply: `Got it! Working on "${this.currentGoal}".`,
      search_query: this.currentGoal,
      direct_url: null,
      intent: 'search'
    };

    if (this.currentSemanticIntent.conversational_reply) {
      this.bus.emit('AGENT_CONVERSATION', {
        text: this.currentSemanticIntent.conversational_reply,
        type: 'initial'
      });
      if (this.voice) {
        this.voice.speak(this.currentSemanticIntent.conversational_reply);
        this.lastSpokenText = this.currentSemanticIntent.conversational_reply.trim().toLowerCase();
      }
    }

    try {
      while (this.isRunning && this.currentStep < this.maxSteps) {
        if (this.isPaused) {
          await this.sleep(300);
          continue;
        }

        this.currentStep++;
        this.bus.emit('STEP_STARTED', { step: this.currentStep, maxSteps: this.maxSteps });

        // --- 1. OBSERVE: Scan active tab DOM and browser state ---
        const pageState = await this.queryPageState();
        if (!pageState) {
          throw new Error('Could not inspect active page DOM');
        }
        this.bus.emit('STEP_OBSERVED', {
          step: this.currentStep,
          url: pageState.url,
          title: pageState.title,
          elementCount: pageState.elementCount || 0
        });

        // Track if active page URL has failed to change across steps
        if (pageState.url && pageState.url === this.lastObservedUrl) {
          this.urlStagnationCount++;
        } else {
          this.urlStagnationCount = 0;
        }
        this.lastObservedUrl = pageState.url || '';

        // --- 2. EVALUATE & REFLECT: Closed-Loop Goal Convergence Check ---
        const convergence = this.evaluateGoalConvergence(this.currentGoal, pageState, this.actionHistory);
        if (convergence.isComplete) {
          console.log('[AgentController] Goal convergence reached:', convergence.summary);
          this.bus.emit('WORKFLOW_COMPLETED', {
            goal: this.currentGoal,
            summary: convergence.summary,
            stepsTaken: this.currentStep
          });
          if (this.voice) {
            await this.voice.speak(convergence.summary);
          }
          await this.cleanupBadges();
          this.isRunning = false;
          return { ok: true, completed: true, steps: this.currentStep, summary: convergence.summary };
        }

        // --- 3. THINK: Autonomous Reasoning Turn (Chrome Built-in AI / Semantic Planner) ---
        this.bus.emit('AGENT_THINKING', { step: this.currentStep });
        const isStagnant = this.consecutiveRepeats > 0;
        const plan = await this.runner.planNextAction(this.currentGoal, pageState, this.actionHistory, isStagnant);
        const actionObj = plan.action || {};

        // --- 3B. INPUT INTERCEPTION & ANTI-STAGNATION SAFEGUARDS ---
        // If model wants to "click" an <input>, <textarea>, or searchbox, auto-convert to "fill"
        if (actionObj.action === 'click' && actionObj.target !== undefined && actionObj.target !== null) {
          const targetEl = (pageState.elements || []).find(e =>
            e.badge === actionObj.target || String(e.badge) === String(actionObj.target)
          );
          if (targetEl) {
            const tag = (targetEl.tag || '').toLowerCase();
            const type = (targetEl.type || '').toLowerCase();
            const role = (targetEl.role || '').toLowerCase();
            const isInput = tag === 'input' || tag === 'textarea' || role === 'searchbox' || role === 'textbox' || type === 'text' || type === 'search';
            if (isInput) {
              const query = actionObj.value || this.extractSearchQuery(this.currentGoal);
              if (query) {
                console.log(`[AgentController] Auto-converting click on input [${actionObj.target}] to fill with "${query}"`);
                actionObj.action = 'fill';
                actionObj.value = query;
                actionObj.key = 'Enter';
                actionObj.speech = `Typing "${query}" and pressing Enter.`;
              }
            }
          }
        }

        // If model output 'navigate' with a target badge, convert to 'click' so the mouse moves and clicks
        if (actionObj.action === 'navigate' && actionObj.target !== undefined && actionObj.target !== null) {
          console.log(`[AgentController] Auto-converting navigate on target [${actionObj.target}] to physical click`);
          actionObj.action = 'click';
        }

        // If model wants to "fill" but omitted value in JSON, auto-extract from thought/speech/goal
        if (actionObj.action === 'fill' && (!actionObj.value || !String(actionObj.value).trim())) {
          let extractedVal = '';
          if (actionObj.thought) {
            const quoteMatch = actionObj.thought.match(/['"]([^'"]{2,})['"]/);
            if (quoteMatch) {
              extractedVal = quoteMatch[1].trim();
            } else {
              const searchMatch = actionObj.thought.match(/search(?:\s+for)?\s+([a-zA-Z0-9\s]+?)(?:\s+(?:on|in|using|to|into|\.|$))/i);
              if (searchMatch) extractedVal = searchMatch[1].trim();
            }
          }
          if (!extractedVal && actionObj.speech) {
            const speechMatch = actionObj.speech.match(/search(?:ing)?(?:\s+for)?\s+([a-zA-Z0-9\s]+?)(?:\s+(?:on|in|using|to|\.|$))/i);
            if (speechMatch) extractedVal = speechMatch[1].trim();
          }
          if (!extractedVal) {
            extractedVal = this.extractSearchQuery(this.currentGoal);
          }
          if (extractedVal) {
            console.log(`[AgentController] Auto-extracted fill value "${extractedVal}" from context`);
            actionObj.value = extractedVal;
          }
          if (!actionObj.key) {
            actionObj.key = 'Enter';
          }
        }

        const currentUrl = pageState.url || '';
        const isSearchEngineHome = (/google\.[a-z.]+(?:\/|\/webhp|\/\?.*)?$/i.test(currentUrl) && !currentUrl.includes('/search')) ||
                                   (/youtube\.com(?:\/|\/\?.*)?$/i.test(currentUrl) && !currentUrl.includes('/results')) ||
                                   (/bing\.com(?:\/|\/\?.*)?$/i.test(currentUrl) && !currentUrl.includes('/search')) ||
                                   currentUrl.startsWith('chrome://newtab') ||
                                   currentUrl === 'about:blank' ||
                                   !currentUrl;

        const isSearchResultPage = (/google\.[a-z.]+\/search/i.test(currentUrl)) ||
                                   (/youtube\.com\/results/i.test(currentUrl)) ||
                                   (/bing\.com\/search/i.test(currentUrl)) ||
                                   (/duckduckgo\.com\/\?q=/i.test(currentUrl));

        const queryFromUrl = (currentUrl.match(/[?&](?:q|search_query)=([^&]+)/i) || [])[1];
        const decodedQuery = queryFromUrl ? decodeURIComponent(queryFromUrl.replace(/\+/g, ' ')).toLowerCase().trim() : '';
        const goalQuery = ((this.currentSemanticIntent && this.currentSemanticIntent.search_query) || this.extractSearchQuery(this.currentGoal)).toLowerCase().trim();
        const isSearchPageForDifferentQuery = isSearchResultPage && !this.searchPerformed && decodedQuery && goalQuery &&
                                              !decodedQuery.includes(goalQuery) && !goalQuery.includes(decodedQuery);

        const isPageActionIntent = this.currentSemanticIntent && (
          this.currentSemanticIntent.intent === 'scroll' ||
          this.currentSemanticIntent.intent === 'read_page' ||
          this.currentSemanticIntent.intent === 'inject_script'
        );
        const isGoalScroll = /\b(?:scroll|bottom|top|niche|neeche|upar|ooper|mis\s*call)\b/i.test(this.currentGoal);

        // Direct Execution of Page-Level Actions (Scroll, Read, Script): NEVER fast-track search for these!
        if (isPageActionIntent || isGoalScroll) {
          if (this.currentSemanticIntent?.intent === 'scroll' || isGoalScroll) {
            let dir = this.currentSemanticIntent?.direction || 'down';
            if (!this.currentSemanticIntent?.direction) {
              if (/\b(?:bottom|niche|neeche|end|last)\b/i.test(this.currentGoal)) dir = 'bottom';
              else if (/\b(?:top|upar|ooper|shuru|start)\b/i.test(this.currentGoal)) dir = 'top';
              else if (/\b(?:up)\b/i.test(this.currentGoal)) dir = 'up';
            }
            if (this.currentStep === 1 || this.actionHistory.length === 0) {
              actionObj.action = 'scroll';
              actionObj.direction = dir;
              actionObj.amount = (dir === 'top' || dir === 'bottom') ? 1000 : 600;
              const isHindi = /[^\u0000-\u007F]|khol|batao|dekha|chutkule|vyavsay|chalao|gaana/i.test(this.currentGoal);
              actionObj.speech = this.currentSemanticIntent?.conversational_reply || (isHindi ? 'Page scroll kar raha hoon.' : 'Scrolling the page for you.');
            } else {
              actionObj.action = 'done';
              const isHindi = /[^\u0000-\u007F]|khol|batao|dekha|chutkule|vyavsay|chalao|gaana/i.test(this.currentGoal);
              actionObj.speech = isHindi ? 'Page scroll ho gaya hai.' : 'Scrolled the page for you.';
            }
          }
        }

        // 1. Destination Resolver: If on blank/newtab page and goal specifies a domain, navigate directly
        const domainMatch = this.currentGoal.match(/\b([a-zA-Z0-9-]+\.(?:com|org|net|io|in|edu|gov|co|ai)(?:\/[^\s]*)?)\b/i);
        if (isSearchEngineHome && this.currentStep === 1 && domainMatch && !actionObj.url) {
          const targetDomainUrl = domainMatch[1].startsWith('http') ? domainMatch[1] : `https://${domainMatch[1]}`;
          console.log(`[AgentController] Direct domain navigation: ${targetDomainUrl}`);
          actionObj.action = 'navigate';
          actionObj.url = targetDomainUrl;
          actionObj.speech = `Opening ${domainMatch[1]} for you.`;
        } else if (!isPageActionIntent && !isGoalScroll && (isSearchEngineHome || isSearchPageForDifferentQuery) && !this.searchPerformed && this.currentStep === 1 && actionObj.action !== 'navigate') {
          // General search only if explicitly on search home/newtab without existing domain
          const query = (this.currentSemanticIntent && this.currentSemanticIntent.search_query) ||
                        actionObj.value ||
                        this.extractSearchQuery(this.currentGoal);
          if (query && query.length > 1 && !domainMatch) {
            const isYt = /youtube|song|gaana|music|video/i.test(this.currentGoal);
            const searchUrl = isYt
              ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
              : `https://www.google.com/search?q=${encodeURIComponent(query)}`;
            console.log(`[AgentController] Direct search query: ${searchUrl}`);
            actionObj.action = 'navigate';
            actionObj.url = searchUrl;
            const isHindi = /[^\u0000-\u007F]|khol|batao|dekha|chutkule|vyavsay|chalao|gaana/i.test(this.currentGoal);
            actionObj.speech = (this.currentSemanticIntent && this.currentSemanticIntent.conversational_reply)
              ? this.currentSemanticIntent.conversational_reply
              : (isHindi ? `Aapke liye "${query}" search kar raha hoon.` : `Searching for "${query}".`);
            this.searchPerformed = true;
          }
        }

        // 2. Direct Work on Search Results: Don't keep searching/typing! Directly open search results!
        if (isSearchResultPage && !isSearchPageForDifferentQuery) {
          const chosenTargetEl = actionObj.target !== undefined && actionObj.target !== null ? (pageState.elements || []).find(e =>
            e.badge === actionObj.target || String(e.badge) === String(actionObj.target)
          ) : null;
          const chosenIsLink = chosenTargetEl && (chosenTargetEl.tag === 'a' || chosenTargetEl.role === 'link') && chosenTargetEl.href && !chosenTargetEl.href.startsWith('#');

          const isSearchInputTarget = chosenTargetEl && (
            chosenTargetEl.tag === 'input' || chosenTargetEl.tag === 'textarea' ||
            chosenTargetEl.role === 'searchbox' || chosenTargetEl.role === 'textbox'
          );

          // If model picked an actual link on the search page, RESPECT model's choice and attach url
          if (actionObj.action === 'click' && chosenIsLink) {
            actionObj.url = chosenTargetEl.href;
            this.hasOpenedSearchResult = true;
          }

          // If model is trying to search AGAIN on the results page or repeated without choosing a link:
          const isRedundantSearchAction = !chosenIsLink && (
            actionObj.action === 'fill' || isSearchInputTarget ||
            (actionObj.action === 'navigate' && /google\.[a-z.]+\/search|youtube\.com\/results/i.test(actionObj.url || '')) ||
            (this.consecutiveRepeats >= 1 && actionObj.action !== 'read_page')
          );

          if (isRedundantSearchAction) {
            const topResult = this.findTopSearchResult(pageState.elements, currentUrl, this.attemptedBadges);
            if (topResult) {
              console.log(`[AgentController] Auto-converting search on results page to opening top result [${topResult.badge}]: "${topResult.text}"`);
              actionObj.action = 'click';
              actionObj.target = topResult.badge;
              actionObj.url = topResult.href || null;
              if (this.attemptedBadges) this.attemptedBadges.add(String(topResult.badge));
              const isHindi = /[^\u0000-\u007F]|khol|batao|dekha|chutkule|vyavsay|chalao|gaana/i.test(this.currentGoal);
              actionObj.speech = isHindi
                ? `Aapke liye website open kar raha hoon: "${topResult.text.substring(0, 35)}"...`
                : `Opening "${topResult.text.substring(0, 40)}" for you...`;
              this.hasOpenedSearchResult = true;
            } else if (actionObj.action !== 'read_page') {
              actionObj.action = 'read_page';
              actionObj.speech = `Reading the search results.`;
            }
          }
        }

        // 3. Goal Completion: If target website opened from search and goal was to open/show website
        const isExternalWebsite = !isSearchEngineHome && !isSearchResultPage &&
                                  currentUrl && !currentUrl.startsWith('chrome://') && !currentUrl.startsWith('about:') &&
                                  (this.hasOpenedSearchResult || this.currentStep >= 2);

        const isSimpleOpenGoal = /khol|open|dekha|show|visit|chalao|play|browse/i.test(this.currentGoal) &&
                                 !/read|summarize|extract|fill|type|buy|form|login/i.test(this.currentGoal);

        if (isExternalWebsite && isSimpleOpenGoal && (this.hasOpenedSearchResult || this.actionHistory.some(h => h.action === 'click' || h.action === 'navigate'))) {
          console.log(`[AgentController] Target website loaded successfully: ${pageState.title || currentUrl}. Concluding goal.`);
          actionObj.action = 'done';
          const isHindi = /[^\u0000-\u007F]|khol|batao|dekha|chutkule|vyavsay|chalao|gaana/i.test(this.currentGoal);
          actionObj.speech = isHindi
            ? `Website open ho gayi hai: ${pageState.title || 'Page'}. Aap dekh sakte hain!`
            : `I've opened the website: ${pageState.title || 'Page'} for you.`;
        }

        // Detect consecutive identical actions
        const actionSig = `${actionObj.action}:${actionObj.target ?? ''}:${actionObj.url ?? ''}:${currentUrl}`;
        if (actionSig === this.lastActionSignature) {
          this.consecutiveRepeats++;
        } else {
          this.consecutiveRepeats = 0;
        }
        this.lastActionSignature = actionSig;

        // Anti-Loop Intervention: Break repeated command cycles without re-searching indefinitely
        const isStagnantLoop = this.consecutiveRepeats >= 2 || (this.consecutiveRepeats >= 1 && this.urlStagnationCount >= 2);
        if (isStagnantLoop || (isSearchEngineHome && this.urlStagnationCount >= 2 && !this.searchPerformed)) {
          this.stagnationInterventions++;
          console.warn(`[AgentController] Stagnant repetition detected (${this.consecutiveRepeats} repeats, URL stagnant: ${this.urlStagnationCount}, interventions: ${this.stagnationInterventions}) for action: ${actionObj.action}`);
          
          if (this.stagnationInterventions >= 3) {
            console.warn(`[AgentController] Stagnation intervention limit reached (${this.stagnationInterventions}). Concluding goal to prevent loop.`);
            actionObj.action = 'done';
            const isHindi = /[^\u0000-\u007F]|khol|batao|dekha|chutkule|vyavsay|chalao|gaana/i.test(this.currentGoal);
            actionObj.speech = isHindi ? `Aapka task complete ho gaya hai.` : `Action completed on the page.`;
            this.consecutiveRepeats = 0;
          } else if (isSearchResultPage) {
            const topResult = this.findTopSearchResult(pageState.elements, currentUrl, this.attemptedBadges);
            if (topResult) {
              console.log(`[AgentController] Breaking stagnant search loop via clicking top result [${topResult.badge}]: ${topResult.href}`);
              actionObj.action = 'click';
              actionObj.target = topResult.badge;
              actionObj.url = topResult.href || null;
              if (this.attemptedBadges) this.attemptedBadges.add(String(topResult.badge));
              const isHindi = /[^\u0000-\u007F]|khol|batao|dekha|chutkule|vyavsay|chalao|gaana/i.test(this.currentGoal);
              actionObj.speech = isHindi
                ? `Website open kar raha hoon: "${topResult.text.substring(0, 35)}"...`
                : `Opening "${topResult.text.substring(0, 40)}" for you...`;
              this.hasOpenedSearchResult = true;
              this.urlStagnationCount = 0;
            } else {
              actionObj.action = 'done';
              const isHindi = /[^\u0000-\u007F]|khol|batao|dekha|chutkule|vyavsay|chalao|gaana/i.test(this.currentGoal);
              actionObj.speech = isHindi ? `Search results check kar liye hain.` : `Finished reviewing search results.`;
              this.consecutiveRepeats = 0;
            }
          } else if (isSearchEngineHome && !this.searchPerformed) {
            const query = actionObj.value || this.extractSearchQuery(this.currentGoal);
            if (query) {
              const searchUrl = /youtube\.com/i.test(currentUrl)
                ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
                : `https://www.google.com/search?q=${encodeURIComponent(query)}`;
              console.log(`[AgentController] Breaking loop via direct search: ${searchUrl}`);
              actionObj.action = 'navigate';
              actionObj.url = searchUrl;
              const isHindi = /[^\u0000-\u007F]|khol|batao|dekha|chutkule|vyavsay|chalao|gaana/i.test(this.currentGoal);
              actionObj.speech = isHindi ? `Aapke liye "${query}" search kar raha hoon.` : `Searching for "${query}".`;
              this.searchPerformed = true;
              this.consecutiveRepeats = 0;
              this.urlStagnationCount = 0;
            }
          } else if (actionObj.action === 'click') {
            const targetEl = (pageState.elements || []).find(e =>
              e.badge === actionObj.target || String(e.badge) === String(actionObj.target)
            );
            if (targetEl && targetEl.href && !targetEl.href.startsWith('javascript:')) {
              console.log(`[AgentController] Converting repeated click to direct link navigation: ${targetEl.href}`);
              actionObj.action = 'navigate';
              actionObj.url = targetEl.href;
              const isHindi = /[^\u0000-\u007F]|khol|batao|dekha|chutkule|vyavsay|chalao|gaana/i.test(this.currentGoal);
              actionObj.speech = isHindi ? `Link open kar raha hoon.` : `Opening link directly.`;
              this.consecutiveRepeats = 0;
            } else if (this.consecutiveRepeats >= 2) {
              actionObj.action = 'done';
              const isHindi = /[^\u0000-\u007F]|khol|batao|dekha|chutkule|vyavsay|chalao|gaana/i.test(this.currentGoal);
              actionObj.speech = isHindi ? `Page par interaction complete ho gaya hai.` : `Completed interaction on the page.`;
              this.consecutiveRepeats = 0;
            }
          } else if (/read|summarize|extract|article|info|page/i.test(this.currentGoal)) {
            console.log(`[AgentController] Breaking loop via read_page.`);
            actionObj.action = 'read_page';
            const isHindi = /[^\u0000-\u007F]|khol|batao|dekha|chutkule|vyavsay|chalao|gaana/i.test(this.currentGoal);
            actionObj.speech = isHindi ? `Page content padh raha hoon.` : `Reading the page content.`;
            this.consecutiveRepeats = 0;
          } else if (this.consecutiveRepeats >= 2) {
            console.log(`[AgentController] Action repeating without progress. Concluding task.`);
            actionObj.action = 'done';
            const isHindi = /[^\u0000-\u007F]|khol|batao|dekha|chutkule|vyavsay|chalao|gaana/i.test(this.currentGoal);
            actionObj.speech = isHindi ? `Aapka task complete ho gaya hai.` : `Action completed on the page.`;
            this.consecutiveRepeats = 0;
          }
        }

        if (actionObj.target !== undefined && actionObj.target !== null && this.attemptedBadges) {
          this.attemptedBadges.add(String(actionObj.target));
        }

        this.bus.emit('AGENT_DECIDED', {
          step: this.currentStep,
          plan: actionObj,
          source: plan.source,
          durationMs: plan.durationMs
        });

        // --- 4. TERMINATION CHECK: If AI declared task complete ---
        if (actionObj.action === 'done') {
          // If model prematurely says done on step 1 when the goal asks for an action and no interaction occurred yet
          const lowerGoal = this.currentGoal.toLowerCase();
          const hasActionIntent = /search|click|find|play|type|fill|open video|login|buy/i.test(lowerGoal);
          if (this.currentStep <= 1 && hasActionIntent && this.actionHistory.length === 0) {
            console.log('[AgentController] Model navigated and prematurely signaled done. Continuing execution loop to observe rendered page.');
            await this.sleep(800);
            continue;
          }

          const finalSummary = actionObj.speech || 'Task completed successfully.';
          this.bus.emit('WORKFLOW_COMPLETED', {
            goal: this.currentGoal,
            summary: finalSummary,
            stepsTaken: this.currentStep
          });
          if (actionObj.speech && this.voice) {
            this.speakSafe(actionObj.speech);
          }
          await this.cleanupBadges();
          this.isRunning = false;
          return { ok: true, completed: true, steps: this.currentStep, summary: finalSummary };
        }

        // --- 5. SPEAK: Audio feedback for intermediate progress (deduplicated) ---
        if (actionObj.speech && this.voice) {
          const normSpeech = actionObj.speech.trim().toLowerCase();
          if (normSpeech !== this.lastSpokenText) {
            this.speakSafe(actionObj.speech);
            this.lastSpokenText = normSpeech;
          }
        }

        // --- 6. ACT: Execute Browser or Page DOM Tool ---
        this.bus.emit('TOOL_EXECUTING', { action: actionObj });
        const execResult = await this.executeTool(actionObj);

        // --- 6B. STATE DELTA & MILESTONE ADVANCEMENT ---
        await this.sleep(400);
        const postState = await this.queryPageState();
        const urlChanged = postState.url !== pageState.url;
        const domChanged = Math.abs((postState.elementCount || 0) - (pageState.elementCount || 0)) > 0;

        if (urlChanged || domChanged) {
          if (this.milestones && this.milestones[this.currentMilestoneIndex]) {
            this.milestones[this.currentMilestoneIndex].status = 'completed';
            this.currentMilestoneIndex++;
            if (this.milestones[this.currentMilestoneIndex]) {
              this.milestones[this.currentMilestoneIndex].status = 'in_progress';
            }
            this.bus.emit('MILESTONES_UPDATED', { milestones: this.milestones });
          }
        }

        // Handle read_page content extraction
        if (actionObj.action === 'read_page' && execResult.ok) {
          const pageText = (execResult.result && execResult.result.text) || execResult.text || '';
          if (pageText) {
            this.lastExtractedText = pageText;
            if (this.voice && !actionObj.speech) {
              const preview = pageText.substring(0, 180).replace(/\s+/g, ' ');
              this.voice.speak(`Read page content: ${preview}`);
            }
          }
        }

        // --- 7. REFLECT & LOG: Record outcome and self-correction context ---
        const outcomeDesc = execResult.ok
          ? (actionObj.action === 'read_page'
              ? `Read page content (${(execResult.result?.wordCount) || 'multiple'} words extracted).`
              : `Successfully executed ${actionObj.action} on ${actionObj.target || actionObj.url || 'page'}.`)
          : `Failed ${actionObj.action}: ${execResult.error || 'Action failed'}.`;

        this.actionHistory.push({
          step: this.currentStep,
          action: actionObj.action,
          target: actionObj.target,
          url: actionObj.url,
          value: actionObj.value,
          thought: actionObj.thought,
          result: execResult,
          outcome: outcomeDesc
        });

        this.bus.emit('STEP_FINISHED', {
          step: this.currentStep,
          result: execResult,
          outcome: outcomeDesc
        });

        // --- 8. SETTLE: Adaptive settlement delay ---
        const delay = (actionObj.action === 'navigate' || actionObj.action === 'open_tab' || (actionObj.action === 'click' && (actionObj.url || execResult?.navigatedUrl))) ? 1200 : 500;
        await this.sleep(delay);
      }

      if (this.currentStep >= this.maxSteps && this.maxSteps !== Infinity) {
        const timeoutMsg = `Task reached step limit (${this.maxSteps} steps).`;
        if (this.voice) await this.voice.speak(timeoutMsg);
        this.bus.emit('WORKFLOW_STOPPED', { reason: timeoutMsg });
      }
    } catch (err) {
      console.error('[AgentController] Workflow error:', err);
      this.bus.emit('WORKFLOW_ERROR', { error: err.message });
      if (this.voice) await this.voice.speak(`Task interrupted: ${err.message}`);
    } finally {
      this.isRunning = false;
      await this.cleanupBadges();
    }
  }

  /**
   * Goal Convergence Evaluator
   * Determines if the active page state satisfies the user's intent
   */
  evaluateGoalConvergence(goal, pageState, history = [], currentAction = null) {
    if (currentAction && currentAction.action === 'done') {
      return { isComplete: true, summary: currentAction.speech || 'Goal accomplished.' };
    }
    if (history.length > 0) {
      const last = history[history.length - 1];
      if (last && last.action === 'done') {
        return { isComplete: true, summary: last.thought || 'Task completed by model.' };
      }
    }

    const normGoal = (goal || '').toLowerCase();
    const isScrollGoal = /\b(?:scroll|bottom|top|niche|neeche|upar|ooper|mis\s*call)\b/i.test(normGoal) &&
                         !/\b(?:how\s+to|what\s+is|meaning|definition|tutorial|video|song|code)\b/i.test(normGoal);

    // If goal is scrolling and a scroll action has executed, task is converged!
    if (isScrollGoal && history.some(h => h.action === 'scroll')) {
      const isHindi = /[^\u0000-\u007F]|khol|batao|dekha|chutkule|vyavsay|chalao|gaana|karo|niche|neeche|upar|ooper/i.test(normGoal);
      return {
        isComplete: true,
        summary: isHindi ? 'Page scroll ho gaya hai.' : 'Page has been scrolled.'
      };
    }

    return { isComplete: false };
  }

  /**
   * Queries active tab state from background service worker with reliable element polling
   */
  async queryPageState(targetTabId = null) {
    const fetchState = () => new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'GET_ACTIVE_PAGE_STATE',
        tabId: targetTabId || this.targetTabId,
        showBadges: true
      }, (resp) => {
        if (chrome.runtime.lastError) {
          const _ = chrome.runtime.lastError.message;
          return resolve({ title: 'Loading...', url: '', elements: [], elementCount: 0 });
        }
        if (!resp || !resp.ok) {
          return resolve({ title: 'Loading...', url: '', elements: [], elementCount: 0 });
        }
        if (resp.tab && resp.tab.id) {
          this.targetTabId = resp.tab.id;
        }
        resolve(resp.state || { elements: [], elementCount: 0 });
      });
    });

    let state = await fetchState();
    // Poll up to 4 times (400ms delay) while elements are 0 or page is in transition
    let retries = 0;
    while ((!state.elements || state.elements.length === 0) && retries < 4) {
      await this.sleep(400);
      state = await fetchState();
      retries++;
    }
    state.extractedContent = this.lastExtractedText || '';
    this.lastPageState = state;
    return state;
  }

  /**
   * Cleans raw text of markdown, reasoning blocks, and JSON syntax before audio output
   */
  sanitizeSpeech(text) {
    if (!text || typeof text !== 'string') return '';
    let clean = text
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<think>[\s\S]*$/gi, '')
      .replace(/```[\s\S]*?```/gi, '')
      .replace(/\{[\s\S]*?\}/gi, '')
      .replace(/["']?thought["']?\s*:\s*["']?/gi, '')
      .replace(/["']?speech["']?\s*:\s*["']?/gi, '')
      .replace(/["']?action["']?\s*:\s*["']?/gi, '')
      .replace(/[{}\[\]"]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return clean;
  }

  /**
   * Dispatches clean spoken audio avoiding raw JSON or machine traces
   */
  speakSafe(text) {
    if (!this.voice || !text) return;
    const clean = this.sanitizeSpeech(text);
    if (clean && clean.length > 1) {
      this.voice.speak(clean);
    }
  }

  /**
   * Sends tool execution request to background service worker
   */
  executeTool(actionObj) {
    const browserTools = ['navigate', 'open_tab', 'close_tab', 'switch_tab', 'list_tabs', 'go_back', 'go_forward', 'reload', 'zoom', 'bookmark', 'download', 'screenshot'];
    
    // Normalize aliases for typing/filling/reading
    let toolAction = (actionObj.action || '').toLowerCase().trim();
    if (toolAction === 'type' || toolAction === 'write' || toolAction === 'input') toolAction = 'fill';
    if (toolAction === 'search') {
      toolAction = 'fill';
      if (!actionObj.key) actionObj.key = 'Enter';
    }
    if (toolAction === 'enter') toolAction = 'press';
    if (toolAction === 'read' || toolAction === 'read_article' || toolAction === 'extract_text' || toolAction === 'readpage') toolAction = 'read_page';
    if (toolAction === 'mouse_move' || toolAction === 'mousemove' || toolAction === 'cursor_move' || toolAction === 'move_cursor' || toolAction === 'pointer_move') toolAction = 'move_mouse';
    if (toolAction === 'mouse_hover' || toolAction === 'mousehover') toolAction = 'hover';
    if (toolAction === 'execute_script' || toolAction === 'run_script' || toolAction === 'eval_script' || toolAction === 'eval' || toolAction === 'script') toolAction = 'inject_script';

    // If toolAction is navigate but targets a DOM badge without a standalone URL, force click
    if (toolAction === 'navigate' && actionObj.target !== undefined && actionObj.target !== null && (!actionObj.url || !/^https?:\/\//i.test(String(actionObj.url)))) {
      toolAction = 'click';
    }

    // Auto-resolve destination URL for clicks so service worker can elevate navigation
    let targetUrl = actionObj.url;
    if (toolAction === 'click' && !targetUrl && actionObj.target !== undefined && actionObj.target !== null) {
      const matchedEl = (this.lastPageState?.elements || []).find(e =>
        e.badge === actionObj.target || String(e.badge) === String(actionObj.target)
      );
      if (matchedEl && matchedEl.href && /^https?:\/\//i.test(matchedEl.href)) {
        targetUrl = matchedEl.href;
      }
    }

    const isBrowserTool = browserTools.includes(toolAction);
    const valueToSend = actionObj.value !== undefined && actionObj.value !== null
      ? actionObj.value
      : (actionObj.text !== undefined ? actionObj.text : (actionObj.query !== undefined ? actionObj.query : (actionObj.content || '')));
    const scriptToSend = actionObj.script || actionObj.code || valueToSend;

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: isBrowserTool ? 'EXECUTE_BROWSER_TOOL' : 'EXECUTE_PAGE_TOOL',
        tabId: this.targetTabId,
        tool: toolAction,
        target: actionObj.target,
        value: valueToSend,
        script: scriptToSend,
        key: actionObj.key,
        direction: actionObj.direction || 'down',
        amount: actionObj.amount || 500,
        url: targetUrl || actionObj.url,
        query: valueToSend || actionObj.query,
        zoomFactor: valueToSend || actionObj.zoomFactor,
        title: actionObj.title,
        x: actionObj.x,
        y: actionObj.y,
        durationMs: actionObj.durationMs,
        useCdp: this.useCdp !== false
      }, (resp) => {
        if (chrome.runtime.lastError) {
          const _ = chrome.runtime.lastError.message;
          return resolve({ ok: false, error: 'Context disconnected' });
        }
        if (resp && resp.tabId) {
          this.targetTabId = resp.tabId;
        }
        resolve(resp || { ok: false });
      });
    });
  }

  /**
   * Removes Set-of-Marks badges from the webpage
   */
  cleanupBadges() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'CLEAR_PAGE_BADGES', tabId: this.targetTabId }, () => {
        if (chrome.runtime.lastError) {
          const _ = chrome.runtime.lastError.message;
        }
        resolve();
      });
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
