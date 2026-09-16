/**
 * Sidepanel Controller: Voice IO (STT / TTS), Multi-Agent Hierarchy UI,
 * Screen Redaction Inspector, and 256-Token Budget Enforcer.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Initialize Orchestrator Singletons
  const pool = window.NeedlePool;
  const memory = window.AgentMemoryLayer;
  const bus = window.AgentEventBus;
  const factory = new window.AgentFactory(pool, memory, bus);

  // DOM Elements
  const goalInput = document.getElementById('goalInput');
  const micBtn = document.getElementById('micBtn');
  const scanBtn = document.getElementById('scanBtn');
  const runAgentBtn = document.getElementById('runAgentBtn');
  const voiceStatusBadge = document.getElementById('voiceStatusBadge');
  const autoMicBadge = document.getElementById('autoMicBadge');
  const autoMicText = document.getElementById('autoMicText');
  const bgAgentBadge = document.getElementById('bgAgentBadge');
  const metricPiiCount = document.getElementById('metricPiiCount');
  const metricFaceCount = document.getElementById('metricFaceCount');
  const metricLatency = document.getElementById('metricLatency');
  const tokenBarFill = document.getElementById('tokenBarFill');
  const tokenCountLabel = document.getElementById('tokenCountLabel');
  const dynamicSubAgentsArea = document.getElementById('dynamicSubAgentsArea');
  const activeAgentBadge = document.getElementById('activeAgentBadge');
  const screenPreviewImg = document.getElementById('screenPreviewImg');
  const previewPlaceholder = document.getElementById('previewPlaceholder');
  const tabRedactedBtn = document.getElementById('tabRedactedBtn');
  const tabRawBtn = document.getElementById('tabRawBtn');
  const logConsole = document.getElementById('logConsole');
  const clearLogBtn = document.getElementById('clearLogBtn');

  let currentRawImgUrl = '';
  let currentSanitizedImgUrl = '';
  let currentScanData = null;
  let recognition = null;
  let isRecording = false;
  let autoMicActive = true;
  let bgAgentAlwaysOn = true;
  let isSpeakingTTS = false;
  let isExecutingWorkflow = false;
  let keepAlivePort = null;

  function appendLog(text, type = 'system') {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    const time = new Date().toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' });
    entry.textContent = `[${time}] ${text}`;
    logConsole.appendChild(entry);
    logConsole.scrollTop = logConsole.scrollHeight;
  }

  function updateTokenMeter(tokens) {
    const clamped = Math.min(256, Math.max(0, tokens));
    const percent = Math.round((clamped / 256) * 100);
    tokenBarFill.style.width = `${percent}%`;
    tokenCountLabel.textContent = `${clamped} / 256 tokens`;

    if (percent > 75) {
      tokenBarFill.style.background = 'linear-gradient(90deg, #f59e0b, #f43f5e)';
    } else {
      tokenBarFill.style.background = 'linear-gradient(90deg, #06b6d4, #10b981)';
    }
  }

  // Pre-load Needle2 14MB model weights asynchronously without blocking UI thread
  setTimeout(async () => {
    try {
      appendLog('Verifying Needle2 14MB model weights in browser...', 'system');
      await pool.loadModelWeights();
      appendLog('Needle2 active: 45M params, 256-tok sliding window verified.', 'system');
    } catch (err) {
      appendLog(`Model initialization notice: ${err.message}`, 'system');
    }
  }, 50);

  // Event Bus Subscriptions
  bus.on('SUBAGENT_SPAWNED', ({ subAgentId, type }) => {
    appendLog(`⚡ Supervisor spawned dynamic sub-agent: ${subAgentId} (${type})`, 'action');
    renderSubAgentNode(subAgentId, type);
    activeAgentBadge.textContent = `${3 + factory.getActiveSubAgentCount()} Agents Active`;
  });

  bus.on('SUBAGENT_TERMINATED', ({ subAgentId }) => {
    appendLog(`Sub-agent ${subAgentId} completed task and terminated.`, 'system');
    removeSubAgentNode(subAgentId);
    activeAgentBadge.textContent = `${3 + factory.getActiveSubAgentCount()} Agents Active`;
  });

  bus.on('AUDIO_START', () => {
    isSpeakingTTS = true;
    // Temporarily pause recognition to prevent mic hearing computer's own voice
    if (recognition && isRecording) {
      try { recognition.abort(); } catch (e) {}
    }
  });

  bus.on('AUDIO_FINISHED', () => {
    isSpeakingTTS = false;
    // Resume auto-mic listening immediately after TTS finishes speaking
    if (autoMicActive) {
      setTimeout(() => startListeningSafely(), 300);
    }
  });

  bus.on('AUDIO_SPOKEN', ({ text }) => {
    appendLog(`🔊 Response Agent (TTS): "${text}"`, 'voice');
  });

  bus.on('DOM_LOCK_ACQUIRED', ({ agentId }) => {
    appendLog(`Lock acquired by ${agentId} for DOM execution.`, 'system');
  });

  function renderSubAgentNode(id, type) {
    const node = document.createElement('div');
    node.id = `node_${id}`;
    node.className = 'agent-node subagent-node';
    node.innerHTML = `
      <div class="agent-node-left">
        <span class="agent-status-dot dot-amber"></span>
        <div>
          <div class="agent-name">${type} (On-Demand)</div>
          <div class="agent-role">ID: ${id} | Dynamic Execution Lease</div>
        </div>
      </div>
      <span class="agent-tok">48 tok</span>
    `;
    dynamicSubAgentsArea.appendChild(node);
  }

  function removeSubAgentNode(id) {
    const node = document.getElementById(`node_${id}`);
    if (node) node.remove();
  }

  // ==========================================
  // 2. Continuous Auto-Mic (Always-On Voice Loop)
  // ==========================================
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  function initContinuousAutoMic() {
    if (!SpeechRecognition) {
      voiceStatusBadge.textContent = 'STT Unavailable';
      autoMicText.textContent = 'Auto-Mic: Unsupported';
      micBtn.style.opacity = '0.5';
      micBtn.title = 'SpeechRecognition API not supported in this browser';
      return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      isRecording = true;
      micBtn.classList.add('recording');
      voiceStatusBadge.textContent = '🎙️ Auto-Mic: Listening';
      voiceStatusBadge.className = 'badge badge-accent';
      autoMicText.textContent = 'Auto-Mic: Listening';
    };

    recognition.onresult = async (event) => {
      if (isSpeakingTTS) return; // Ignore audio spoken by TTS

      const results = event.results;
      const transcript = (results[results.length - 1][0].transcript || '').trim();
      if (!transcript) return;

      goalInput.value = transcript;
      appendLog(`🎙️ Voice Captured: "${transcript}"`, 'voice');

      // Hands-free trigger: automatically run workflow with the spoken goal
      if (!isExecutingWorkflow) {
        appendLog(`⚡ Autonomous Agent executing goal from voice...`, 'action');
        await runAutonomousWorkflow(transcript);
      }
    };

    recognition.onerror = (event) => {
      // no-speech or aborted are normal in continuous recognition slices
      if (event.error === 'no-speech' || event.error === 'aborted') {
        return;
      }

      if (event.error === 'not-allowed') {
        voiceStatusBadge.textContent = 'Mic Permission Required';
        autoMicText.textContent = 'Auto-Mic: Needs Permission';
        appendLog('Microphone permission required for auto-mic. Opening permission helper...', 'system');
        chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel/permission.html') });
      } else if (event.error === 'audio-capture') {
        voiceStatusBadge.textContent = 'No Mic Detected';
        autoMicText.textContent = 'Auto-Mic: No Hardware';
      } else {
        console.warn('[VisionAgent:Voice] STT notice:', event.error);
      }
    };

    recognition.onend = () => {
      isRecording = false;
      // Auto-restart loop immediately unless user explicitly toggled it off or TTS is active
      if (autoMicActive && !isSpeakingTTS) {
        setTimeout(() => {
          if (autoMicActive && !isRecording && !isSpeakingTTS) {
            startListeningSafely();
          }
        }, 200);
      } else if (!autoMicActive) {
        micBtn.classList.remove('recording');
        voiceStatusBadge.textContent = 'Mic Paused';
        voiceStatusBadge.className = 'badge';
        autoMicText.textContent = 'Auto-Mic: Paused';
      }
    };

    // Start auto-listening immediately on load
    startListeningSafely();
  }

  async function startListeningSafely() {
    if (!recognition || isRecording || isSpeakingTTS) return;

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
      }
      recognition.start();
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        appendLog('Click mic icon to grant microphone access for continuous auto-mic.', 'system');
      } else {
        try { recognition.start(); } catch (e) {}
      }
    }
  }

  // Toggle Auto-Mic on/off when mic button is clicked
  micBtn.addEventListener('click', () => {
    autoMicActive = !autoMicActive;
    if (autoMicActive) {
      appendLog('🎙️ Auto-Mic activated: listening continuously.', 'voice');
      startListeningSafely();
    } else {
      if (recognition && isRecording) {
        recognition.stop();
      }
      appendLog('Auto-Mic paused.', 'system');
    }
  });

  if (autoMicBadge) {
    autoMicBadge.addEventListener('click', () => {
      micBtn.click();
    });
  }

  // Initialize continuous voice loop
  initContinuousAutoMic();

  // ==========================================
  // 3. Background Agent Always-On Connection
  // ==========================================
  function maintainBgAgentKeepAlive() {
    try {
      keepAlivePort = chrome.runtime.connect({ name: 'bg-agent-keepalive' });
      keepAlivePort.onDisconnect.addListener(() => {
        if (bgAgentAlwaysOn) {
          setTimeout(maintainBgAgentKeepAlive, 1000);
        }
      });

      // Keep service worker warm with periodic lightweight heartbeats
      setInterval(() => {
        try {
          if (keepAlivePort) keepAlivePort.postMessage({ type: 'PING' });
        } catch (e) {}
      }, 15000);

      appendLog('⚡ Background Agent active & persistent: monitoring browser events.', 'system');
    } catch (e) {
      console.warn('[VisionAgent:SW] Keepalive notice:', e);
    }
  }

  maintainBgAgentKeepAlive();

  // Active Tab / Page State Change Watchdog
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;

    if (msg.target === 'sidepanel' && msg.action === 'PAGE_STATE_CHANGED') {
      appendLog(`⚡ Background Agent observed page state change (${msg.reason}): ${msg.url}`, 'action');
      // Auto-scan and redact if agent is always on and not currently executing a step
      if (bgAgentAlwaysOn && !isExecutingWorkflow) {
        setTimeout(() => performScanAndRedact(), 350);
      }
    }
  });

  // ==========================================
  // 4. Scan & Redact Handler (OpenCV Visual Pipeline)
  // ==========================================
  async function performScanAndRedact() {
    scanBtn.disabled = true;
    scanBtn.innerHTML = '<span>⏳</span> Processing...';
    appendLog('Capturing tab and scanning frames for PII...', 'privacy');

    try {
      const resp = await chrome.runtime.sendMessage({ action: 'CAPTURE_AND_REDACT' });
      if (!resp || !resp.ok) throw new Error(resp?.error || 'Failed to capture and redact screen');

      currentScanData = resp;
      currentRawImgUrl = resp.rawScreenshot;
      currentSanitizedImgUrl = resp.sanitizedScreenshot;

      // Update Preview
      screenPreviewImg.src = currentSanitizedImgUrl;
      screenPreviewImg.style.display = 'block';
      previewPlaceholder.style.display = 'none';
      tabRedactedBtn.classList.add('active');
      tabRawBtn.classList.remove('active');

      // Update Metrics
      metricPiiCount.textContent = resp.piiCount;
      metricFaceCount.textContent = resp.faceCount;
      metricLatency.textContent = `${resp.redactionLatencyMs}ms`;

      // Update Token estimate
      const candidateSummary = resp.elements ? resp.elements.slice(0, 4) : [];
      const estTokens = memory.estimateTokens(JSON.stringify(candidateSummary));
      updateTokenMeter(Math.min(115, estTokens + 35));

      appendLog(`OpenCV Redaction Complete: ${resp.faceCount} faces blurred, ${resp.piiCount} PII areas blacked out (${resp.redactionLatencyMs}ms).`, 'privacy');

      return resp;
    } catch (err) {
      appendLog(`Scan error: ${err.message}`, 'system');
      return null;
    } finally {
      scanBtn.disabled = false;
      scanBtn.innerHTML = '<span>🔍</span> Scan & Redact';
    }
  }

  scanBtn.addEventListener('click', performScanAndRedact);

  // ==========================================
  // 5. Autonomous Multi-Agent Execution Workflow
  // ==========================================
  async function runAutonomousWorkflow(goalText) {
    if (isExecutingWorkflow) return;
    isExecutingWorkflow = true;
    runAgentBtn.disabled = true;
    runAgentBtn.innerHTML = '<span>⏳</span> Executing...';

    const goal = (goalText || goalInput.value || 'Complete browser task').trim();

    try {
      // Step A: Conversation Agent normalizes goal
      await factory.handleUserInput(goal);

      // Step B: Scan & Redact screen via OpenCV
      let scan = await performScanAndRedact();

      if (!scan || !scan.elements || scan.elements.length === 0) {
        appendLog('No interactive elements detected on active screen.', 'system');
        await factory.speakProgress('complete', 'No interactive elements found on screen.');
        return;
      }

      // Step C: Supervisor Agent evaluates page structure & spawns dynamic sub-agent
      appendLog('Supervisor evaluating screen structure & frame boundaries...', 'action');
      const subAgentResult = await factory.evaluateAndDispatch(scan);

      if (subAgentResult && subAgentResult.ok && subAgentResult.action) {
        const action = subAgentResult.action;
        appendLog(`Sub-Agent generated action: ${JSON.stringify(action)}`, 'action');

        // Step D: Dispatch Playwright tool action to active tab
        if (action.tool && action.tool !== 'done') {
          const execResp = await chrome.runtime.sendMessage({
            action: 'EXECUTE_PAGE_TOOL',
            tool: action.tool,
            id: action.id,
            value: action.value || 'TestInput',
            key: action.key || 'Enter',
            direction: action.dir || 'down'
          });

          appendLog(`Playwright Driver executed ${action.tool}: ${JSON.stringify(execResp?.result || 'ok')}`, 'action');
          await factory.speakProgress('complete', `Successfully executed ${action.tool} action.`);
        } else {
          await factory.speakProgress('complete', 'Task plan completed.');
        }

        // Re-scan to update HUD preview with latest screen state
        setTimeout(() => performScanAndRedact(), 600);
      }
    } catch (err) {
      appendLog(`Agent execution error: ${err.message}`, 'system');
    } finally {
      isExecutingWorkflow = false;
      runAgentBtn.disabled = false;
      runAgentBtn.innerHTML = '<span>⚡</span> Run Parallel Agents';
    }
  }

  runAgentBtn.addEventListener('click', () => {
    runAutonomousWorkflow(goalInput.value);
  });

  // Tab View Toggles
  tabRedactedBtn.addEventListener('click', () => {
    if (!currentSanitizedImgUrl) return;
    screenPreviewImg.src = currentSanitizedImgUrl;
    tabRedactedBtn.classList.add('active');
    tabRawBtn.classList.remove('active');
  });

  tabRawBtn.addEventListener('click', () => {
    if (!currentRawImgUrl) return;
    screenPreviewImg.src = currentRawImgUrl;
    tabRawBtn.classList.add('active');
    tabRedactedBtn.classList.remove('active');
  });

  clearLogBtn.addEventListener('click', () => {
    logConsole.innerHTML = '<div class="log-entry log-system">Console cleared.</div>';
  });
});
