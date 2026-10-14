# Gemma 4 Autonomous Browser Agent

A 100% offline, voice-controlled Chrome Extension (Manifest V3) that provides autonomous browser control using loop engineering. Runs entirely on local offline models: Localhost Ollama (`gemma2:2b`), Chrome Built-in On-Device AI (`window.ai`), or in-browser WebGPU.

Zero external cloud API keys, zero remote telemetry, 100% private and offline.

---

## Architecture Overview

```
User Voice / Text
       │
       ▼
Side Panel UI ──► Voice Controller (Web Speech STT + Native TTS)
       │
       ▼
Agent Controller (Closed-Loop Engine)
  ├── 1. OBSERVE   : Background Service Worker -> Content Script (DOM & Shadow DOM scan)
  ├── 2. EVALUATE  : Goal Convergence Check (detects completion automatically)
  ├── 3. THINK     : Gemma 4 Runner (Localhost Ollama -> Chrome Built-in AI -> WebGPU)
  ├── 4. ACT       : Playwright Driver (Click, Fill, Press, Scroll, Tabs, Navigation)
  ├── 5. REFLECT   : Self-correction feedback into history
  └── 6. REPEAT    : Next step until convergence reached
```

---

## 1. Quick Installation in Google Chrome

1. Open Google Chrome.
2. In the URL bar, go to `chrome://extensions`.
3. Toggle **Developer mode** (top-right corner) to **ON**.
4. Click **Load unpacked** (top-left).
5. Select the `extension/` folder inside this repository:
   ```
   c:\Users\anamika sakal\Downloads\shashi\nsp\extension
   ```
6. The extension icon will appear in your Chrome toolbar.
7. Click the extension icon to open the **Gemma 4 Side Panel**.

> **Note**: Whenever you update any extension files or service workers, click the **🔄 Reload Ext** button in the sidepanel settings or click the reload icon on `chrome://extensions`.

---

## 2. Connecting Your Offline AI Model

The agent runs 100% locally. Choose your preferred offline model backend:

### Option A: Localhost Ollama (`gemma2:2b` - Default & Recommended)

Runs locally on your GPU/CPU via Ollama with zero cloud dependencies.

1. Ensure Ollama is installed and running:
   ```powershell
   ollama pull gemma2:2b
   ```
   *(Model size: 1.6 GB)*
2. Verify Ollama is listening on IPv4 port `11434` (Ollama runs automatically as a Windows background tray process).
3. In the extension sidepanel drawer, **Localhost Ollama (gemma2:2b - 100% Offline)** is selected with endpoint `http://127.0.0.1:11434`.
4. Click **💾 Connect Ollama**. The status badge shows `Ollama: gemma2:2b`.

---

### Option B: Chrome Built-in On-Device AI (Prompt API / Gemini Nano)

Uses Chrome's native on-device model with zero external network calls.

1. Open `chrome://flags` in Chrome.
2. Search and set the following flags to **Enabled**:
   - `#prompt-api-for-gemini-nano` -> **Enabled**
   - `#optimization-guide-on-device-model` -> **Enabled BypassPerfRequirement**
3. Click **Relaunch** to restart Chrome.
4. Go to `chrome://components` and verify **Optimization Guide On Device Model** is downloaded.
5. In the extension sidepanel settings, select **Chrome Built-in AI (window.ai - On-Device)** and click **Save & Connect**.

---

### Option C: In-Browser WebGPU (Hardware Accelerated)

Runs compute shaders directly on your GPU inside an isolated Chrome offscreen document without needing Ollama or external binaries running.

1. Select **In-Browser WebGPU (Local Model)** in the sidepanel dropdown.
2. The sidepanel automatically tests and verifies hardware adapter access, device limits, and WGSL compute shader execution.
3. When active, decisions and reasoning occur directly inside browser memory.

---

## 3. Milestone Decomposition & Hardware CDP Input

- **Milestone-Driven Autonomy**: Instead of rigid command-by-command macros, enter high-level natural language goals (e.g. `"Go to Wikipedia and look up Quantum Computing"`). The agent decomposes the goal into sub-milestones, tracks progress dynamically, and advances across steps based on real state deltas (URL and DOM changes).
- **Hardware CDP Events (`isTrusted: true`)**: With the **Hardware CDP Events** toggle enabled in Settings, the agent dispatches input through `chrome.debugger` (`Input.dispatchMouseEvent` and `Input.dispatchKeyEvent`). This bypasses bot filters and triggers synthetic frameworks (React, Angular, Vue) without artificial script interference.

---

## 4. Microphone & Voice Setup

1. Click the microphone orb button in the sidepanel or press speech input.
2. Chrome will prompt for microphone permission.
3. If not prompted automatically, open `chrome-extension://<EXTENSION_ID>/sidepanel/permission.html` and click **Allow Microphone Access**.
4. Once granted, speak natural requirements hands-free.

---

## 5. Supported Browser Tools & Commands

| Tool | Action | Example Natural Requirement |
|---|---|---|
| **Navigate** | Direct domain or URL loading | `"Open Wikipedia"`, `"Go to github.com"` |
| **Fill & Search** | Types text and submits forms via CDP/DOM | `"Find machine learning articles"`, `"Fill username"` |
| **Click** | Dispatches trusted hardware clicks | `"Click the first search result"`, `"Click Submit"` |
| **Read Page** | Extracts clean semantic text & structure | `"Read this article to me"`, `"What does this say?"` |
| **Scroll** | Physical wheel scroll down/up | `"Scroll down to read more"` |
| **Tabs** | Browser tab creation, switching, closing | `"New tab"`, `"Switch tab to Wikipedia"` |

---

## 6. Verification & Testing

Run the included automated verification scripts to ensure code integrity:

```powershell
# 1. Verify JSON and JS syntax across all 13 extension files:
powershell -ExecutionPolicy Bypass -File scripts\verify_syntax.ps1

# 2. Run full 109-point automated test suite:
powershell -ExecutionPolicy Bypass -File test\test_offline_agent.ps1
```

Both tests pass with exit code 0 (`All 109 tests PASSED flawlessly!`).
