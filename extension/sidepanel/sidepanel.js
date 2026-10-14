/**
 * Sidepanel Controller: Gemma 4 Autonomous Browser Agent
 * Connects Voice IO (STT / Audio TTS), Set-of-Marks Page HUD,
 * and Gemma 4 Autonomous Multi-Step Execution Loop.
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize Core Orchestrator Singletons
  const bus = window.AgentEventBus || (typeof window.EventBus === 'function' ? new window.EventBus() : null);
  const memory = new window.MemoryLayer();
  const runner = new window.Gemma4Runner();

  // Voice Controller Instance
  let voiceController = null;

  // DOM Elements
  const goalInput = document.getElementById('goalInput');
  const micOrbBtn = document.getElementById('micOrbBtn');
  const runTaskBtn = document.getElementById('runTaskBtn');
  const pauseTaskBtn = document.getElementById('pauseTaskBtn');
  const stopTaskBtn = document.getElementById('stopTaskBtn');
  const ttsToggleBtn = document.getElementById('ttsToggleBtn');
  const ttsIcon = document.getElementById('ttsIcon');
  const refreshPageBtn = document.getElementById('refreshPageBtn');
  const readPageBtn = document.getElementById('readPageBtn');
  const injectScriptBtn = document.getElementById('injectScriptBtn');
  const voiceStatusBadge = document.getElementById('voiceStatusBadge');
  const voiceStatusText = document.getElementById('voiceStatusText');
  const pageTitleLabel = document.getElementById('pageTitleLabel');
  const pageUrlLabel = document.getElementById('pageUrlLabel');
  const elementCountLabel = document.getElementById('elementCountLabel');
  const stepCountLabel = document.getElementById('stepCountLabel');
  const latencyLabel = document.getElementById('latencyLabel');
  const engineLabel = document.getElementById('engineLabel');
  const activityStream = document.getElementById('activityStream');
  const clearStreamBtn = document.getElementById('clearStreamBtn');
  const backendSelect = document.getElementById('backendSelect');
  const ollamaUrlGroup = document.getElementById('ollamaUrlGroup');
  const ollamaUrl = document.getElementById('ollamaUrl');
  const saveModelSettingsBtn = document.getElementById('saveModelSettingsBtn');
  const reloadExtBtn = document.getElementById('reloadExtBtn');
  const voiceRateSlider = document.getElementById('voiceRateSlider');
  const milestoneSection = document.getElementById('milestoneSection');
  const milestoneList = document.getElementById('milestoneList');
  const milestoneProgressTag = document.getElementById('milestoneProgressTag');
  const cdpToggle = document.getElementById('cdpToggle');

  let isAudioMuted = false;
  let keepAlivePort = null;
  let keepAliveInterval = null;

  // 2. Activity Stream Logger
  function addStreamEntry(title, desc, typeClass = 'item-action', speechText = null) {
    if (!activityStream) return;
    const item = document.createElement('div');
    item.className = `stream-item ${typeClass}`;

    let icon = '⚡';
    if (typeClass === 'item-speech') icon = '🔊';
    if (typeClass === 'item-success') icon = '✅';
    if (typeClass === 'item-error') icon = '❌';

    item.innerHTML = `
      <div class="stream-icon">${icon}</div>
      <div class="stream-content">
        <div class="stream-title">${escapeHtml(title)}</div>
        <div class="stream-desc">${escapeHtml(desc)}</div>
        ${speechText ? `<div class="stream-speech">"${escapeHtml(speechText)}"</div>` : ''}
      </div>
    `;

    activityStream.appendChild(item);
    activityStream.scrollTop = activityStream.scrollHeight;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // 3. Initialize Voice IO
  voiceController = new window.VoiceController({
    onTranscription: ({ text, isFinal }) => {
      goalInput.value = text;
      if (isFinal) {
        addStreamEntry('🎙️ Voice Input', `Recognized: "${text}"`, 'item-speech');
        const trimmed = text.trim();
        if (trimmed.length > 1) {
          addStreamEntry('⚡ Hands-Free Auto-Run', `Executing prompt automatically without manual click...`, 'item-action');
          agent.executeGoal(trimmed);
        }
      }
    },
    onStateChange: ({ listening, speaking, text }) => {
      if (listening) {
        micOrbBtn.classList.add('active');
        voiceStatusText.textContent = 'Listening...';
        voiceStatusBadge.style.color = '#f43f5e';
      } else {
        micOrbBtn.classList.remove('active');
        voiceStatusText.textContent = speaking ? 'Speaking...' : 'Voice Ready';
        voiceStatusBadge.style.color = speaking ? '#06b6d4' : '#10b981';
      }

      if (speaking && text) {
        addStreamEntry('🔊 Spoken Audio', text, 'item-speech');
      }
    }
  });

  // 4. Initialize Agent Controller
  const agent = new window.AgentController(runner, bus, voiceController);

  // 5. ATTACH ALL UI LISTENERS IMMEDIATELY (SYNCHRONOUS - NEVER FREEZES)
  micOrbBtn.addEventListener('click', async () => {
    await voiceController.toggleListening();
  });

  runTaskBtn.addEventListener('click', async () => {
    const goal = goalInput.value.trim();
    if (!goal) {
      alert('Please speak or type a task goal first.');
      return;
    }
    await agent.executeGoal(goal);
  });

  pauseTaskBtn.addEventListener('click', () => {
    if (agent.isPaused) {
      agent.resume();
      pauseTaskBtn.innerHTML = '<span>⏸</span> Pause';
    } else {
      agent.pause();
      pauseTaskBtn.innerHTML = '<span>▶️</span> Resume';
    }
  });

  stopTaskBtn.addEventListener('click', async () => {
    await agent.stop();
  });

  ttsToggleBtn.addEventListener('click', () => {
    isAudioMuted = !isAudioMuted;
    voiceController.setMuted(isAudioMuted);
    ttsIcon.textContent = isAudioMuted ? '🔇' : '🔊';
    ttsToggleBtn.style.opacity = isAudioMuted ? '0.5' : '1';
  });

  refreshPageBtn.addEventListener('click', () => {
    refreshActivePage();
  });

  if (readPageBtn) {
    readPageBtn.addEventListener('click', async () => {
      goalInput.value = 'Read and summarize the content of this page';
      await agent.executeGoal('Read and summarize the content of this page');
    });
  }

  if (injectScriptBtn) {
    injectScriptBtn.addEventListener('click', async () => {
      const userGoal = goalInput ? goalInput.value.trim() : '';
      const defaultScript = (/^(?:inject|run|execute|eval|\/\/|document\.|window\.|console\.)/i.test(userGoal))
        ? userGoal.replace(/^(?:inject|run|execute|eval):?\s*/i, '').trim()
        : 'console.log("Injected from Gemma Copilot:", document.title); document.title;';
      const code = prompt('Enter JavaScript code to inject into webpage:', defaultScript);
      if (!code || !code.trim()) return;

      const cleanCode = code.trim();
      addStreamEntry('💉 Injecting Script', cleanCode.length > 80 ? cleanCode.slice(0, 80) + '...' : cleanCode, 'item-action');
      chrome.runtime.sendMessage({
        action: 'EXECUTE_PAGE_TOOL',
        tool: 'inject_script',
        script: cleanCode
      }, (resp) => {
        if (chrome.runtime.lastError) {
          addStreamEntry('❌ Script Injection Error', chrome.runtime.lastError.message, 'item-error');
          return;
        }
        if (resp && resp.ok) {
          const retVal = resp.result !== undefined ? (typeof resp.result === 'object' ? JSON.stringify(resp.result) : String(resp.result)) : 'Executed successfully';
          addStreamEntry('✅ Script Executed', `Result: ${retVal}`, 'item-success');
          refreshActivePage();
        } else {
          addStreamEntry('❌ Script Failed', resp?.error || 'Execution failed', 'item-error');
        }
      });
    });
  }

  clearStreamBtn.addEventListener('click', () => {
    activityStream.innerHTML = '';
  });

  // Backend Selection and Settings
  backendSelect.addEventListener('change', async () => {
    updateSettingsVisibility();
    runner.preferredBackend = backendSelect.value;
    await chrome.storage.local.set({ modelBackend: backendSelect.value });
    refreshEngineStatus().catch(() => {});
  });

  saveModelSettingsBtn.addEventListener('click', async () => {
    const backend = backendSelect.value;
    const url = (ollamaUrl.value || 'http://127.0.0.1:11434').trim().replace('localhost', '127.0.0.1');

    runner.ollamaUrl = url;
    runner.preferredBackend = backend;
    runner._cachedModel = null; // Clear cached model so it re-queries tags immediately
    await chrome.storage.local.set({
      modelBackend: backend,
      ollamaUrl: url
    });

    addStreamEntry('💾 Settings Saved', `Engine: ${backendSelect.options[backendSelect.selectedIndex].text}`, 'item-success');
    refreshEngineStatus().catch(() => {});
  });

  if (reloadExtBtn) {
    reloadExtBtn.addEventListener('click', () => {
      addStreamEntry('🔄 Reloading Extension', 'Reloading extension service worker and UI...', 'item-action');
      setTimeout(() => {
        chrome.runtime.reload();
      }, 300);
    });
  }

  voiceRateSlider.addEventListener('input', (e) => {
    voiceController.speechRate = parseFloat(e.target.value);
  });

  // Keyboard shortcut: Press Enter in textarea to launch task
  goalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      runTaskBtn.click();
    }
  });

  if (cdpToggle) {
    cdpToggle.addEventListener('change', async () => {
      agent.useCdp = cdpToggle.checked;
      await chrome.runtime.sendMessage({ action: 'TOGGLE_CDP', enabled: cdpToggle.checked });
      addStreamEntry('🔧 Hardware CDP', cdpToggle.checked ? 'CDP Trusted events enabled.' : 'In-page DOM mode active.', 'item-action');
    });
  }

  // 6. ATTACH ALL EVENT BUS LISTENERS IMMEDIATELY
  bus.on('MILESTONES_UPDATED', ({ milestones }) => {
    if (!milestones || milestones.length === 0) {
      if (milestoneSection) milestoneSection.style.display = 'none';
      return;
    }
    if (milestoneSection) milestoneSection.style.display = 'block';
    const completedCount = milestones.filter(m => m.status === 'completed').length;
    if (milestoneProgressTag) milestoneProgressTag.textContent = `${completedCount}/${milestones.length}`;
    if (milestoneList) {
      milestoneList.innerHTML = milestones.map(m => {
        let icon = '⏳';
        if (m.status === 'in_progress') icon = '⚡';
        if (m.status === 'completed') icon = '✅';
        return `
          <div class="milestone-item ${m.status}">
            <span class="m-icon">${icon}</span>
            <span class="m-title">${escapeHtml(m.title)}</span>
          </div>
        `;
      }).join('');
    }
  });

  bus.on('WORKFLOW_STARTED', ({ goal }) => {
    runTaskBtn.disabled = true;
    pauseTaskBtn.disabled = false;
    stopTaskBtn.disabled = false;
    addStreamEntry('🚀 Task Started', goal, 'item-action');
  });

  bus.on('AGENT_CONVERSATION', ({ text }) => {
    addStreamEntry('💬 AI Copilot', text, 'item-speech');
  });

  bus.on('STEP_STARTED', ({ step, maxSteps }) => {
    stepCountLabel.textContent = (maxSteps && maxSteps !== Infinity) ? `${step} / ${maxSteps}` : `Step ${step}`;
  });

  bus.on('AGENT_THINKING', ({ step }) => {
    voiceStatusText.textContent = `Thinking (Step ${step})...`;
  });

  bus.on('AGENT_DECIDED', ({ step, plan, source, durationMs }) => {
    latencyLabel.textContent = `${durationMs || 0}ms`;
    const targetBadge = plan.target ? `[${plan.target}]` : '';
    const desc = `${plan.action ? plan.action.toUpperCase() : 'ACTION'} ${targetBadge}: ${plan.thought || ''}`;
    addStreamEntry(`Step ${step} (${source || 'gemma'})`, desc, 'item-action', plan.speech);
  });

  bus.on('TOOL_EXECUTING', ({ action }) => {
    voiceStatusText.textContent = `Executing: ${action.action}...`;
  });

  bus.on('WORKFLOW_COMPLETED', ({ goal, summary, stepsTaken }) => {
    runTaskBtn.disabled = false;
    pauseTaskBtn.disabled = true;
    stopTaskBtn.disabled = true;
    stepCountLabel.textContent = `Done (${stepsTaken} steps)`;
    voiceStatusText.textContent = 'Voice Ready';
    addStreamEntry('🎉 Task Completed', summary, 'item-success');
    refreshActivePage();
  });

  bus.on('WORKFLOW_STOPPED', ({ reason }) => {
    runTaskBtn.disabled = false;
    pauseTaskBtn.disabled = true;
    stopTaskBtn.disabled = true;
    voiceStatusText.textContent = 'Voice Ready';
    addStreamEntry('⏹ Task Stopped', reason, 'item-error');
  });

  bus.on('WORKFLOW_ERROR', ({ error }) => {
    runTaskBtn.disabled = false;
    pauseTaskBtn.disabled = true;
    stopTaskBtn.disabled = true;
    voiceStatusText.textContent = 'Error';
    addStreamEntry('❌ Task Error', error, 'item-error');
  });

  // 7. Page State Query
  function refreshActivePage() {
    chrome.runtime.sendMessage({ action: 'GET_ACTIVE_PAGE_STATE', showBadges: true }, (resp) => {
      if (chrome.runtime.lastError) {
        const _ = chrome.runtime.lastError.message;
        pageTitleLabel.textContent = 'Active Webpage';
        pageUrlLabel.textContent = 'Ready';
        elementCountLabel.textContent = '0';
        return;
      }
      if (!resp || !resp.ok) {
        pageTitleLabel.textContent = 'Browser Ready';
        pageUrlLabel.textContent = 'Give any navigation or search command';
        elementCountLabel.textContent = '0';
        return;
      }

      const state = resp.state || {};
      pageTitleLabel.textContent = state.title || resp.tab?.title || 'Active Tab';
      pageUrlLabel.textContent = state.url || resp.tab?.url || 'chrome://newtab';
      elementCountLabel.textContent = resp.isInternal ? 'Ready' : (state.elementCount || state.elements?.length || 0).toString();
    });
  }

  function updateSettingsVisibility() {
    const val = backendSelect.value;
    if (val === 'ollama') {
      ollamaUrlGroup.style.display = 'flex';
    } else {
      ollamaUrlGroup.style.display = 'none';
    }
  }

  // 8. Offline Engine Verification & Connection
  async function refreshEngineStatus() {
    const val = backendSelect.value;
    runner.preferredBackend = val;
    runner._cachedModel = null; // Always re-probe available models

    if (val === 'ollama') {
      const url = (ollamaUrl.value || 'http://127.0.0.1:11434').trim().replace('localhost', '127.0.0.1');
      runner.ollamaUrl = url;
      engineLabel.textContent = 'Connecting Ollama...';

      const ollamaRes = await runner.queryOllamaBridge('OLLAMA_TAGS');
      if (ollamaRes && ollamaRes.ok) {
        const models = ollamaRes.models || [];
        const modelName = models.find(m => /gemma4|gemma-4/i.test(m.name))?.name ||
                          models.find(m => /gemma/i.test(m.name))?.name ||
                          (models[0]?.name || 'gemma4:e2b');
        runner._cachedModel = modelName;
        engineLabel.textContent = `Ollama: ${modelName}`;
        addStreamEntry('🧠 Offline Engine Connected', `Local Ollama model "${modelName}" is active and ready (100% offline).`, 'item-success');
        return;
      } else {
        engineLabel.textContent = 'Ollama Offline';
        addStreamEntry('⚠️ Ollama Not Reachable', `Could not connect to Ollama at ${runner.ollamaUrl}. Ensure Ollama is running with gemma4:e2b.`, 'item-error');
        return;
      }
    }

    if (val === 'chrome_ai') {
      engineLabel.textContent = 'Checking Chrome AI...';
      const info = await runner.checkNativeAiAvailability();
      if (info && info.supported) {
        engineLabel.textContent = 'Chrome Built-in AI';
        addStreamEntry('🧠 On-Device AI Active', 'Chrome Built-in AI (Prompt API) is active.', 'item-success');
        return;
      } else {
        engineLabel.textContent = 'Chrome AI Offline';
        addStreamEntry('ℹ️ Chrome AI Offline', 'Enable on-device AI in chrome://flags to use Chrome local AI.', 'item-error');
        return;
      }
    }

    if (val === 'webgpu') {
      engineLabel.textContent = 'Checking WebGPU...';
      try {
        const offscreenRes = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ target: 'offscreen', action: 'CHECK_STATUS' }, (res) => {
            if (chrome.runtime.lastError) return resolve(null);
            resolve(res);
          });
        });
        if (offscreenRes && offscreenRes.webgpu) {
          const gpuVendor = offscreenRes.gpuInfo?.vendor || 'WebGPU Device';
          engineLabel.textContent = 'WebGPU: Active';
          addStreamEntry('⚡ WebGPU Acceleration Ready', `WebGPU hardware acceleration verified (${gpuVendor}). Compute shaders active.`, 'item-success');
          return;
        } else {
          engineLabel.textContent = 'WebGPU Inactive';
          addStreamEntry('⚠️ WebGPU Notice', 'WebGPU compute device not initialized or unsupported on current display adapter.', 'item-error');
          return;
        }
      } catch (_) {
        engineLabel.textContent = 'WebGPU Selected';
      }
      return;
    }
  }

  async function initModelEngine() {
    try {
      const saved = await chrome.storage.local.get(['modelBackend', 'ollamaUrl']);
      const validBackends = ['ollama', 'chrome_ai', 'webgpu'];
      const chosen = validBackends.includes(saved.modelBackend) ? saved.modelBackend : 'ollama';
      backendSelect.value = chosen;

      const url = (saved.ollamaUrl || 'http://127.0.0.1:11434').trim().replace('localhost', '127.0.0.1');
      ollamaUrl.value = url;
      runner.ollamaUrl = url;
      runner.preferredBackend = chosen;

      await chrome.storage.local.set({ modelBackend: chosen, ollamaUrl: url });

      updateSettingsVisibility();
      await refreshEngineStatus();
    } catch (e) {
      console.warn('[Sidepanel] Engine init notice:', e);
    }
  }

  // 9. Service Worker Persistent Keep-Alive (Single Timer)
  function connectKeepAlive() {
    try {
      if (keepAliveInterval) clearInterval(keepAliveInterval);
      keepAlivePort = chrome.runtime.connect({ name: 'gemma-agent-keepalive' });
      keepAlivePort.onDisconnect.addListener(() => {
        setTimeout(connectKeepAlive, 1500);
      });
      keepAliveInterval = setInterval(() => {
        if (keepAlivePort) {
          try { keepAlivePort.postMessage({ type: 'PING' }); } catch (_) {}
        }
      }, 10000);
    } catch (_) {}
  }

  // 10. Start non-blocking background initialization
  connectKeepAlive();
  refreshActivePage();
  initModelEngine().catch((err) => console.error('[Sidepanel] Init error:', err));
});
