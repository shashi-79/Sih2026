/**
 * Sidepanel Controller: Gemma 4 Autonomous Browser Agent
 * Connects Voice IO (STT / Audio TTS), Set-of-Marks Page HUD,
 * and Gemma 4 Autonomous Multi-Step Execution Loop.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Initialize Core Orchestrator Singletons
  const bus = new window.EventBus();
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
  const ollamaUrl = document.getElementById('ollamaUrl');
  const voiceRateSlider = document.getElementById('voiceRateSlider');

  let isAudioMuted = false;
  let keepAlivePort = null;

  // 2. Initialize Voice IO
  voiceController = new window.VoiceController({
    onTranscription: ({ text, isFinal }) => {
      goalInput.value = text;
      if (isFinal) {
        addStreamEntry('🎙️ Voice Input', `Recognized: "${text}"`, 'item-speech');
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

  // 3. Initialize Agent Controller
  const agent = new window.AgentController(runner, bus, voiceController);

  // 4. Activity Stream Logger
  function addStreamEntry(title, desc, typeClass = 'item-action', speechText = null) {
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

  // 5. Query and Render Active Page State
  async function refreshActivePage() {
    chrome.runtime.sendMessage({ action: 'GET_ACTIVE_PAGE_STATE', showBadges: true }, (resp) => {
      if (chrome.runtime.lastError || !resp || !resp.ok) {
        pageTitleLabel.textContent = 'No accessible webpage';
        pageUrlLabel.textContent = 'Open an HTTP/HTTPS webpage';
        elementCountLabel.textContent = '0';
        return;
      }

      const state = resp.state || {};
      pageTitleLabel.textContent = state.title || resp.tab?.title || 'Active Tab';
      pageUrlLabel.textContent = state.url || resp.tab?.url || '';
      elementCountLabel.textContent = (state.elementCount || state.elements?.length || 0).toString();
    });
  }

  // Refresh page HUD immediately
  refreshActivePage();

  // Probe Chrome Native Built-in AI (window.ai) with Gemma 4
  runner.checkNativeAiAvailability().then((isAvailable) => {
    if (isAvailable) {
      engineLabel.textContent = 'Gemma 4 (Built-in)';
      addStreamEntry('🧠 Engine Active', 'Chrome Built-in AI with Gemma 4 is active and ready.', 'item-success');
    }
  });

  // 6. UI Event Listeners
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

  clearStreamBtn.addEventListener('click', () => {
    activityStream.innerHTML = '';
  });

  // Settings
  backendSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'chrome_ai') {
      engineLabel.textContent = 'Chrome Built-in AI';
    } else if (val === 'ollama') {
      engineLabel.textContent = 'Ollama:gemma-4';
    } else if (val === 'webgpu') {
      engineLabel.textContent = 'Gemma-4-WebGPU';
    } else {
      engineLabel.textContent = 'Auto Hybrid';
    }
    chrome.storage.local.set({ modelBackend: val });
  });

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

  // 7. Event Bus Subscriptions
  bus.on('WORKFLOW_STARTED', ({ goal }) => {
    runTaskBtn.disabled = true;
    pauseTaskBtn.disabled = false;
    stopTaskBtn.disabled = false;
    addStreamEntry('🚀 Task Started', goal, 'item-action');
  });

  bus.on('STEP_STARTED', ({ step, maxSteps }) => {
    stepCountLabel.textContent = `${step} / ${maxSteps}`;
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

  // 8. Service Worker Persistent Keep-Alive
  function connectKeepAlive() {
    try {
      keepAlivePort = chrome.runtime.connect({ name: 'gemma-agent-keepalive' });
      keepAlivePort.onDisconnect.addListener(() => {
        setTimeout(connectKeepAlive, 1000);
      });
      setInterval(() => {
        if (keepAlivePort) {
          try { keepAlivePort.postMessage({ type: 'PING' }); } catch (_) {}
        }
      }, 10000);
    } catch (_) {}
  }
  connectKeepAlive();
});
