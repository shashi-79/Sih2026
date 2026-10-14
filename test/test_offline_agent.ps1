$ErrorActionPreference = "Stop"

$workspaceRoot = Split-Path $PSScriptRoot -Parent
$extensionDir = Join-Path $workspaceRoot "extension"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Running Automated Test Suite: Gemma 4 Browser Agent" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$testResults = @()

function Assert-Test($name, $condition) {
    if ($condition) {
        Write-Host "[PASS] $name" -ForegroundColor Green
        return @{ Name = $name; Passed = $true }
    } else {
        Write-Host "[FAIL] $name" -ForegroundColor Red
        return @{ Name = $name; Passed = $false }
    }
}

# Test 1: Manifest Integrity & V3 compliance
$manifestPath = Join-Path $extensionDir "manifest.json"
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$testResults += Assert-Test "Manifest is V3" ($manifest.manifest_version -eq 3)
$testResults += Assert-Test "Extension Name is Gemma 4 Agent" ($manifest.name -like "*Gemma 4*")
$testResults += Assert-Test "Required permissions present" ($manifest.permissions -contains "sidePanel" -and $manifest.permissions -contains "offscreen")

# Test 2: Purge Verification - Needle2 and OpenCV files must NOT exist
$needleCact = Join-Path $extensionDir "weights\needle2.cact"
$opencvJs = Join-Path $extensionDir "weights\opencv.js"
$needlePool = Join-Path $extensionDir "orchestrator\needle_pool.js"
$needleWorker = Join-Path $extensionDir "orchestrator\needle_worker.js"
$agentFactory = Join-Path $extensionDir "orchestrator\agent_factory.js"

$testResults += Assert-Test "Needle2 .cact weight file purged" (!(Test-Path $needleCact))
$testResults += Assert-Test "OpenCV.js purged" (!(Test-Path $opencvJs))
$testResults += Assert-Test "Needle2 pool script purged" (!(Test-Path $needlePool))
$testResults += Assert-Test "Needle2 worker script purged" (!(Test-Path $needleWorker))
$testResults += Assert-Test "Legacy agent factory purged" (!(Test-Path $agentFactory))

# Test 3: New Gemma 4 Architecture files must exist
$gemmaRunner = Join-Path $extensionDir "orchestrator\gemma4_runner.js"
$agentController = Join-Path $extensionDir "orchestrator\agent_controller.js"
$voiceController = Join-Path $extensionDir "sidepanel\voice_controller.js"
$offscreenJs = Join-Path $extensionDir "offscreen\offscreen.js"
$contentScript = Join-Path $extensionDir "content\content-script.js"
$playwrightDriver = Join-Path $extensionDir "content\playwright_driver.js"
$downloadScript = Join-Path $workspaceRoot "scripts\download_gemma4.ps1"

$testResults += Assert-Test "Gemma 4 Runner exists" (Test-Path $gemmaRunner)
$testResults += Assert-Test "Agent Controller exists" (Test-Path $agentController)
$testResults += Assert-Test "Voice Controller exists" (Test-Path $voiceController)
$testResults += Assert-Test "Offscreen WebGPU worker exists" (Test-Path $offscreenJs)
$testResults += Assert-Test "Content script exists" (Test-Path $contentScript)
$testResults += Assert-Test "Playwright driver exists" (Test-Path $playwrightDriver)
$testResults += Assert-Test "Download script exists" (Test-Path $downloadScript)

# Test 4: Download Script TestMode execution
$modelManifest = Join-Path $extensionDir "models\gemma4\model_manifest.json"
$testResults += Assert-Test "Model manifest exists" (Test-Path $modelManifest)

# Test 5: Verify no residual needle references in orchestrator & sidepanel
$sidepanelHtml = Get-Content (Join-Path $extensionDir "sidepanel\sidepanel.html") -Raw
$sidepanelJs = Get-Content (Join-Path $extensionDir "sidepanel\sidepanel.js") -Raw
$offscreenHtml = Get-Content (Join-Path $extensionDir "offscreen\offscreen.html") -Raw

$testResults += Assert-Test "sidepanel.html free of needle2" ($sidepanelHtml -notmatch "needle2" -and $sidepanelHtml -notmatch "needle_pool")
$testResults += Assert-Test "sidepanel.html free of opencv" ($sidepanelHtml -notmatch "opencv")
$testResults += Assert-Test "sidepanel.js free of needle2" ($sidepanelJs -notmatch "NeedlePool" -and $sidepanelJs -notmatch "needle2")
$testResults += Assert-Test "offscreen.html free of opencv.js" ($offscreenHtml -notmatch "opencv.js")

# Test 6: Verify Service Worker frame isolation and internal page safety
$swJs = Get-Content (Join-Path $extensionDir "background\service-worker.js") -Raw
$testResults += Assert-Test "Service worker isolates to top frame (frameId: 0)" ($swJs -match "frameId:\s*0")
$testResults += Assert-Test "Service worker handles internal pages gracefully" ($swJs -match "isInternal")

# Test 7: Verify Content Script comprehensive element scanning
$csJs = Get-Content (Join-Path $extensionDir "content\content-script.js") -Raw
$testResults += Assert-Test "Content script scans anchor links (a[href])" ($csJs -match "a\[href\]")
$testResults += Assert-Test "Content script includes idempotency guard" ($csJs -match "__gemma_agent_injected__")

# Test 8: Verify LLM-First Runner & Closed-Loop Convergence (No Blind Search Fallback)
$grJs = Get-Content (Join-Path $extensionDir "orchestrator\gemma4_runner.js") -Raw
$acJs = Get-Content (Join-Path $extensionDir "orchestrator\agent_controller.js") -Raw
$spJs = Get-Content (Join-Path $extensionDir "sidepanel\sidepanel.js") -Raw

$testResults += Assert-Test "Runner is LLM-First (Prompt API & Ollama integration)" ($grJs -match "inferViaOllama" -and $grJs -match "getPromptSession")
$testResults += Assert-Test "Runner purged blind scripted search fallback" ($grJs -notmatch "google\.com/search\?q=")
$testResults += Assert-Test "Agent Controller has loop engineering convergence evaluation" ($acJs -match "evaluateGoalConvergence")
$testResults += Assert-Test "Sidepanel has hands-free auto-run on speech transcription" ($spJs -match "Hands-Free Auto-Run")

# Test 9: Verify Task Limit is Unlimited (Infinity) and HUD No-Limit display
$testResults += Assert-Test "Agent Controller has unlimited task steps (maxSteps = Infinity)" ($acJs -match "maxSteps\s*=\s*Infinity")
$testResults += Assert-Test "Sidepanel HTML step label set to Steps (No Limit)" ($sidepanelHtml -match "Steps \(No Limit\)")

# Test 10: Verify Reliable Input Fill Mechanics & Event Dispatching
$pwdJs = Get-Content (Join-Path $extensionDir "content\playwright_driver.js") -Raw
$testResults += Assert-Test "Playwright driver resets React _valueTracker on input fill" ($pwdJs -match "_valueTracker")
$testResults += Assert-Test "Playwright driver fires synthetic InputEvent insertText" ($pwdJs -match "InputEvent\('input'.*insertText")
$testResults += Assert-Test "Playwright driver sets keyCode 13 on Enter keypress" ($pwdJs -match "keyCode\s*=\s*isEnter\s*\?\s*13")
$testResults += Assert-Test "Content script extracts numeric digits for target lookup" ($csJs -match "match\(/\\d\+/\)")
$testResults += Assert-Test "Content script has input fallback for fill tool" ($csJs -match "(?s)activeElement.*INPUT")
$testResults += Assert-Test "Runner normalizes action aliases (type, write, search -> fill)" ($grJs -match "normalizeActionObject" -and $grJs -match "act === 'type'")

# Test 11: Verify 'read_page' Tool Implementation across Content Script, Runner, and Controller
$testResults += Assert-Test "Content script includes extractCleanPageContent helper" ($csJs -match "extractCleanPageContent")
$testResults += Assert-Test "Content script dispatches read_page tool execution" ($csJs -match "tool === 'read_page'")
$testResults += Assert-Test "Gemma runner includes read_page in systemPrompt TOOLS" ($grJs -match "read_page")
$testResults += Assert-Test "Gemma runner normalizes read/extract_text to read_page" ($grJs -match "act\s*=\s*'read_page'")
$testResults += Assert-Test "Agent controller tracks and handles read_page extracted text" ($acJs -match "lastExtractedText")
$testResults += Assert-Test "Sidepanel has readPageBtn button in DOM and listener" ($sidepanelHtml -match "readPageBtn" -and $spJs -match "readPageBtn")

# Test 12: Verify Anti-Repetition Guards, Loop Detection, and Click-to-Fill Auto Conversion
$testResults += Assert-Test "Runner normalizes click with value to fill" ($grJs -match "act === 'click' && obj\.value")
$testResults += Assert-Test "Runner parseToolCall supports compound click-and-type" ($grJs -match "clickAndType")
$testResults += Assert-Test "Runner adjusts temperature dynamically when stagnant" ($grJs -match "isStagnant \? 0\.45 : 0\.1")
$testResults += Assert-Test "Agent Controller includes extractSearchQuery helper" ($acJs -match "extractSearchQuery")
$testResults += Assert-Test "Agent Controller auto-converts input clicks to fill" ($acJs -match "Auto-converting click on input")
$testResults += Assert-Test "Agent Controller detects consecutive identical action signatures" ($acJs -match "consecutiveRepeats\+\+")
$testResults += Assert-Test "Agent Controller has loop breaker for stagnant repetitions" ($acJs -match "consecutiveRepeats >= 2")

# Test 13: Verify Direct Work on Search Results & Spoken Audio Deduplication
$testResults += Assert-Test "Agent Controller includes findTopSearchResult helper" ($acJs -match "findTopSearchResult")
$testResults += Assert-Test "Agent Controller converts search results loop to top result click" ($acJs -match "Auto-converting search on results page to opening top result")
$testResults += Assert-Test "Agent Controller deduplicates speech to eliminate vocal loops" ($acJs -match "normSpeech !== this\.lastSpokenText")
$testResults += Assert-Test "Agent Controller marks searchPerformed to prevent repeat searches" ($acJs -match "this\.searchPerformed = true")

# Test 14: Verify Pure AI Intent Understanding & Conversational Audio Copilot
$vcJs = Get-Content (Join-Path $extensionDir "sidepanel\voice_controller.js") -Raw
$testResults += Assert-Test "Runner implements extractIntentAndConversation without regex" ($grJs -match "extractIntentAndConversation")
$testResults += Assert-Test "Agent Controller purged rigid search-query regex block" ($acJs -notmatch "khol\\s\+kar\\s\+batao")
$testResults += Assert-Test "Agent Controller sets currentSemanticIntent from AI pipeline" ($acJs -match "currentSemanticIntent")
$testResults += Assert-Test "Voice Controller includes findBestVoice for natural phonetic audio" ($vcJs -match "findBestVoice")
$testResults += Assert-Test "Sidepanel renders AGENT_CONVERSATION interactive messages" ($spJs -match "AGENT_CONVERSATION")

# Test 15: Verify Reliable Link Navigation & Universal Physical Scrolling
$testResults += Assert-Test "Playwright driver overrides anchor target=_blank to prevent popup block" ($pwdJs -match "anchor\.setAttribute\('target',\s*'_self'\)")
$testResults += Assert-Test "Playwright driver unwraps search engine redirect URLs" ($pwdJs -match "cleanNavUrl\.includes\('/url\?'\)")
$testResults += Assert-Test "Playwright driver returns navigatedUrl on click" ($pwdJs -match "navigatedUrl:\s*cleanNavUrl")
$testResults += Assert-Test "Playwright driver scroll dispatches synthetic WheelEvent" ($pwdJs -match "new WheelEvent\('wheel'")
$testResults += Assert-Test "Playwright driver scroll adjusts document.scrollingElement and containers" ($pwdJs -match "document\.scrollingElement\.scrollTop\s*\+=")
$testResults += Assert-Test "Service worker elevates link clicks via chrome.tabs.update" ($swJs -match "Elevating link click navigation via chrome\.tabs\.update")

# Test 16: Verify Resilient Truncated JSON Repair & Speech Sanitization
$testResults += Assert-Test "Runner includes repairAndParseTruncatedJson helper" ($grJs -match "repairAndParseTruncatedJson")
$testResults += Assert-Test "Runner rejects unparseable JSON from defaulting to done" ($grJs -match "(?s)isJsonLike.*return null")
$testResults += Assert-Test "Agent Controller includes sanitizeSpeech to filter raw JSON syntax" ($acJs -match "sanitizeSpeech")
$testResults += Assert-Test "Agent Controller includes speakSafe for clean TTS audio" ($acJs -match "speakSafe")

# Test 17: Verify Virtual Mouse Cursor Control, Trajectory Movement & Click Animation
$testResults += Assert-Test "Playwright driver injects visual AI cursor element (__gemma_agent_cursor__)" ($pwdJs -match "__gemma_agent_cursor__")
$testResults += Assert-Test "Playwright driver implements expanding click ripple (__gemma_cursor_ripple__)" ($pwdJs -match "__gemma_cursor_ripple__")
$testResults += Assert-Test "Playwright driver implements smooth moveMouse interpolation" ($pwdJs -match "moveMouse\(targetX,\s*targetY")
$testResults += Assert-Test "Playwright driver implements moveToElement element target gliding" ($pwdJs -match "moveToElement\(target")
$testResults += Assert-Test "Playwright driver dispatches pointermove along movement trajectory" ($pwdJs -match "PointerEvent\('pointermove'")
$testResults += Assert-Test "Playwright driver glides mouse cursor on click" ($pwdJs -match "(?s)click\(target\).*moveMouse.*showClickRipple")
$testResults += Assert-Test "Playwright driver glides mouse cursor on input fill" ($pwdJs -match "(?s)fill\(target,.*moveMouse.*showClickRipple")
$testResults += Assert-Test "Content script handles move_mouse tool execution" ($csJs -match "tool === 'move_mouse'")
$testResults += Assert-Test "Gemma runner systemPrompt defines move_mouse tool" ($grJs -match "move_mouse")
$testResults += Assert-Test "Gemma runner normalizes mouse movement aliases to move_mouse" ($grJs -match "act === 'mouse_move'.*move_mouse")
$testResults += Assert-Test "Agent Controller forwards move_mouse tool and coordinate parameters" ($acJs -match "toolAction === 'mouse_move'.*move_mouse" -and $acJs -match "durationMs:\s*actionObj\.durationMs")
# Test 18: Verify Website Script Injection & Navigate-to-Click Conversion
$spHtml = Get-Content (Join-Path $extensionDir "sidepanel\sidepanel.html") -Raw
$testResults += Assert-Test "Playwright driver implements injectScript method" ($pwdJs -match "static async injectScript\(script\)")
$testResults += Assert-Test "Content script handles inject_script tool execution" ($csJs -match "tool === 'inject_script'")
$testResults += Assert-Test "Service worker handles inject_script with MAIN world execution" ($swJs -match "case 'inject_script':" -and $swJs -match "world:\s*'MAIN'")
$testResults += Assert-Test "Agent Controller auto-converts navigate on target element to click" ($acJs -match "Auto-converting navigate on target .* to physical click")
$testResults += Assert-Test "Agent Controller normalizes and forwards inject_script tool with script payload" ($acJs -match "act === 'execute_script'.*inject_script" -or $acJs -match "toolAction === 'execute_script'.*inject_script")
$testResults += Assert-Test "Gemma runner systemPrompt defines inject_script tool" ($grJs -match "inject_script")
$testResults += Assert-Test "Gemma runner parses inject script in NLP intent extraction" ($grJs -match "action:\s*'inject_script'")
$testResults += Assert-Test "Sidepanel HTML includes injectScriptBtn" ($spHtml -match "id=""injectScriptBtn""")
$testResults += Assert-Test "Sidepanel JS wires up injectScriptBtn click listener" ($spJs -match "injectScriptBtn\.addEventListener\('click'")

# Test 19: Verify Phonetic STT Normalization, Direct Page Action Execution, and Anti-Loop Circuit Breaker
$testResults += Assert-Test "Runner implements normalizeVoicePhonetics for accent variances" ($grJs -match "normalizeVoicePhonetics" -and $grJs -match "mis\\s\*call")
$testResults += Assert-Test "Runner handles scroll directions (bottom, top, down, up) in normalization" ($grJs -match "bottom.*top.*down.*up" -or $grJs -match "act === 'scroll'.*obj\.direction")
$testResults += Assert-Test "Agent Controller tracks attemptedBadges to prevent duplicate clicks" ($acJs -match "attemptedBadges")
$testResults += Assert-Test "Agent Controller limits stagnation interventions to prevent infinite loops" ($acJs -match "stagnationInterventions >= 3")
$testResults += Assert-Test "Agent Controller evaluates scroll goal convergence" ($acJs -match "isScrollGoal.*action === 'scroll'")
$testResults += Assert-Test "findTopSearchResult filters out excludeBadges" ($acJs -match "findTopSearchResult\(elements,\s*currentUrl,\s*excludeBadges")

# Test 20: Verify Chrome DevTools Protocol (CDP) Controller & Trusted Hardware Input
$cdpJs = Join-Path $extensionDir "background\cdp_controller.js"
$testResults += Assert-Test "CDP Controller script exists" (Test-Path $cdpJs)
$testResults += Assert-Test "Manifest includes debugger permission for CDP" ($manifest.permissions -contains "debugger")
$cdpContent = Get-Content $cdpJs -Raw
$testResults += Assert-Test "CDP Controller implements attach, clickAt, typeText, and getFullAXTree" ($cdpContent -match "attach" -and $cdpContent -match "clickAt" -and $cdpContent -match "typeText" -and $cdpContent -match "getFullAXTree")
$testResults += Assert-Test "Service worker imports and routes CDP actions" ($swJs -match "importScripts\('cdp_controller\.js'\)" -and $swJs -match "CdpController")
$testResults += Assert-Test "Sidepanel HTML includes cdpToggle" ($spHtml -match "id=""cdpToggle""")

# Test 21: Verify Genuine In-Browser WebGPU Compute Pipeline
$offscreenRaw = Get-Content (Join-Path $extensionDir "offscreen\offscreen.js") -Raw
$testResults += Assert-Test "Offscreen script implements initWebGPU" ($offscreenRaw -match "initWebGPU")
$testResults += Assert-Test "Offscreen script executes WGSL compute shader" ($offscreenRaw -match "@compute" -and $offscreenRaw -match "createComputePipeline")
$testResults += Assert-Test "Offscreen script provides honest WebGPU status check" ($offscreenRaw -match "In-Browser WebGPU \(Hardware Accelerated\)")
$testResults += Assert-Test "Gemma runner supports preferredBackend webgpu dispatch" ($grJs -match "preferredBackend === 'webgpu'" -or $grJs -match "this\.preferredBackend")

# Test 22: Verify Milestone-Driven Autonomous Decomposition & State Delta
$testResults += Assert-Test "Agent Controller implements decomposeGoalIntoMilestones" ($acJs -match "decomposeGoalIntoMilestones")
$testResults += Assert-Test "Agent Controller tracks milestones checklist" ($acJs -match "this\.milestones")
$testResults += Assert-Test "Sidepanel HTML includes milestoneSection and milestoneList" ($spHtml -match "id=""milestoneSection""" -and $spHtml -match "id=""milestoneList""")
$testResults += Assert-Test "Sidepanel JS handles MILESTONES_UPDATED message" ($spJs -match "MILESTONES_UPDATED")

# Test 23: Verify Semantic Context Extraction & Label Association
$testResults += Assert-Test "Content script extracts headings and alerts context" ($csJs -match "headings" -and $csJs -match "alerts")
$testResults += Assert-Test "Content script associates form inputs with labels" ($csJs -match "label\[for=" -and $csJs -match "aria-labelledby")

$failed = $testResults | Where-Object { !$_.Passed }

Write-Host "----------------------------------------------------------" -ForegroundColor Cyan
if ($failed.Count -eq 0) {
    Write-Host "All $($testResults.Count) tests PASSED flawlessly!" -ForegroundColor Green
    exit 0
} else {
    Write-Host "$($failed.Count) test(s) failed." -ForegroundColor Red
    exit 1
}
