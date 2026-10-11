$ErrorActionPreference = "Stop"

$workspaceRoot = "c:\Users\anamika sakal\Downloads\shashi\Sih"
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

$failed = $testResults | Where-Object { !$_.Passed }

Write-Host "----------------------------------------------------------" -ForegroundColor Cyan
if ($failed.Count -eq 0) {
    Write-Host "All $($testResults.Count) tests PASSED flawlessly!" -ForegroundColor Green
    exit 0
} else {
    Write-Host "$($failed.Count) test(s) failed." -ForegroundColor Red
    exit 1
}
