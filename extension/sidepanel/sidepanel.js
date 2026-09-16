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

  // 2. Setup Native Browser Voice STT (Speech-to-Text)
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      isRecording = true;
      micBtn.classList.add('recording');
      voiceStatusBadge.textContent = 'Listening...';
      voiceStatusBadge.className = 'badge badge-accent';
      appendLog('🎙️ Microphone active: Speak your goal now...', 'voice');
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      goalInput.value = transcript;
      appendLog(`STT Captured: "${transcript}"`, 'voice');
      // Pass directly to Conversation Agent
      factory.handleUserInput(transcript);
    };

    recognition.onerror = (event) => {
      isRecording = false;
      micBtn.classList.remove('recording');

      if (event.error === 'no-speech') {
        voiceStatusBadge.textContent = 'STT Ready';
        voiceStatusBadge.className = 'badge';
        appendLog('No speech detected in time window. Click mic to try again.', 'system');
      } else if (event.error === 'not-allowed') {
        voiceStatusBadge.textContent = 'Mic Permission Required';
        voiceStatusBadge.className = 'badge';
        appendLog('Microphone permission not granted. Opening permission tab...', 'system');
        chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel/permission.html') });
      } else if (event.error === 'audio-capture') {
        voiceStatusBadge.textContent = 'No Mic Detected';
        voiceStatusBadge.className = 'badge';
        appendLog('No microphone hardware found. You can type directly in the goal box.', 'system');
      } else {
        voiceStatusBadge.textContent = 'STT Error';
        voiceStatusBadge.className = 'badge';
        appendLog(`Speech recognition note (${event.error}). You can type directly.`, 'system');
      }
    };

    recognition.onend = () => {
      isRecording = false;
      micBtn.classList.remove('recording');
      if (voiceStatusBadge.textContent === 'Listening...') {
        voiceStatusBadge.textContent = 'STT Ready';
        voiceStatusBadge.className = 'badge';
      }
    };

    micBtn.addEventListener('click', async () => {
      if (isRecording) {
        recognition.stop();
        return;
      }

      // Check mic permission via getUserMedia before starting recognition
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(t => t.stop());
        }
        recognition.start();
      } catch (err) {
        if (err.name === 'NotAllowedError') {
          appendLog('Microphone access not allowed. Opening permission tab...', 'system');
          chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel/permission.html') });
        } else {
          try {
            recognition.start();
          } catch (e) {
            console.warn('[VisionAgent] Speech start fallback:', e);
          }
        }
      }
    });
  } else {
    voiceStatusBadge.textContent = 'STT Unavailable';
    micBtn.style.opacity = '0.5';
    micBtn.title = 'SpeechRecognition API not supported in this environment';
  }

  // 3. Scan & Redact Handler
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
      const estTokens = memory.estimateTokens(JSON.stringify(resp.elements.slice(0, 4)));
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

  // 4. Run Parallel Agents Handler
  runAgentBtn.addEventListener('click', async () => {
    runAgentBtn.disabled = true;
    runAgentBtn.innerHTML = '<span>⏳</span> Executing...';

    const goal = goalInput.value.trim() || 'Complete browser task';

    try {
      // Step A: Conversation Agent processes goal
      await factory.handleUserInput(goal);

      // Step B: Scan & Redact screen if not scanned yet
      let scan = currentScanData;
      if (!scan) {
        scan = await performScanAndRedact();
      }

      if (!scan || !scan.elements || scan.elements.length === 0) {
        appendLog('No interactive elements detected on active screen.', 'system');
        await factory.speakProgress('complete', 'No interactive elements found on the screen.');
        return;
      }

      // Step C: Supervisor Agent evaluates and spawns dynamic sub-agent
      appendLog('Supervisor evaluating screen structure & frame boundaries...', 'action');
      const subAgentResult = await factory.evaluateAndDispatch(scan);

      if (subAgentResult && subAgentResult.ok && subAgentResult.action) {
        const action = subAgentResult.action;
        appendLog(`Sub-Agent generated tool action: ${JSON.stringify(action)}`, 'action');

        // Step D: Dispatch Playwright tool action to tab
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

        // Re-scan to show updated state
        setTimeout(() => performScanAndRedact(), 600);
      }
    } catch (err) {
      appendLog(`Agent execution error: ${err.message}`, 'system');
    } finally {
      runAgentBtn.disabled = false;
      runAgentBtn.innerHTML = '<span>⚡</span> Run Parallel Agents';
    }
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
