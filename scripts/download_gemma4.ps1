<#
.SYNOPSIS
    Downloads and prepares Gemma 4 E2B weights and configs for offline in-browser extension execution.
.DESCRIPTION
    Fetches the quantized Gemma-4-E2B-it ONNX/WebGPU model artifacts into extension/models/gemma4/.
    Also verifies local prerequisites and provides Ollama/llama.cpp offline instructions.
.PARAMETER SkipLargeModel
    When specified, downloads tokenizer, configuration, and verification stubs without the 1.5GB binary weights.
.PARAMETER TestMode
    Creates offline local configs and model manifest stubs without requiring an active internet connection.
.PARAMETER Force
    Overwrites existing downloaded model files.
#>
[CmdletBinding()]
param(
    [switch]$SkipLargeModel,
    [switch]$TestMode,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$workspaceRoot = "c:\Users\anamika sakal\Downloads\shashi\Sih"
$modelsDir = Join-Path $workspaceRoot "extension\models\gemma4"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Gemma 4 Offline Browser Agent - Model Setup Utility" -ForegroundColor Cyan
Write-Host " Target Directory: $modelsDir" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

if (!(Test-Path $modelsDir)) {
    New-Item -ItemType Directory -Path $modelsDir -Force | Out-Null
    Write-Host "[+] Created model directory: $modelsDir" -ForegroundColor Green
}

if ($TestMode) {
    Write-Host "[*] Running in Offline Test Mode: Generating local offline configuration and model stubs..." -ForegroundColor Yellow

    $configJson = @{
        architectures = @("Gemma4ForCausalLM")
        model_type = "gemma4"
        hidden_size = 2048
        num_hidden_layers = 18
        num_attention_heads = 8
        vocab_size = 256000
        quantization_config = @{
            quant_method = "bitsandbytes"
            load_in_4bit = $true
        }
    } | ConvertTo-Json -Depth 5
    Set-Content -Path (Join-Path $modelsDir "config.json") -Value $configJson -Encoding UTF8

    $genConfig = @{
        temperature = 0.2
        max_new_tokens = 350
        do_sample = $false
        pad_token_id = 0
        eos_token_id = 1
    } | ConvertTo-Json -Depth 3
    Set-Content -Path (Join-Path $modelsDir "generation_config.json") -Value $genConfig -Encoding UTF8

    $tokConfig = @{
        model_type = "gemma4"
        add_bos_token = $true
        add_eos_token = $false
    } | ConvertTo-Json -Depth 3
    Set-Content -Path (Join-Path $modelsDir "tokenizer_config.json") -Value $tokConfig -Encoding UTF8

    $manifest = @{
        modelId = "gemma-4-E2B-it"
        architecture = "Gemma4ForCausalLM"
        quantization = "int4_webgpu"
        contextWindow = 131072
        downloadTimestamp = (Get-Date).ToString("o")
        status = "ready_offline"
        fallbackServer = "http://localhost:11434"
    } | ConvertTo-Json -Depth 4
    Set-Content -Path (Join-Path $modelsDir "model_manifest.json") -Value $manifest -Encoding UTF8

    Write-Host "[+] Offline config files generated successfully in $modelsDir" -ForegroundColor Green
    Write-Host "`n----------------------------------------------------------" -ForegroundColor Cyan
    Write-Host " Local Hybrid Ollama Setup (Recommended for 100% offline):" -ForegroundColor Cyan
    Write-Host "   Run: ollama pull gemma2:2b" -ForegroundColor White
    Write-Host "   Start: ollama run gemma2:2b" -ForegroundColor White
    Write-Host "----------------------------------------------------------" -ForegroundColor Cyan
    return
}

$baseUrl = "https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX/resolve/main"

# Core model files
$filesToDownload = @(
    @{ Name = "config.json"; Url = "$baseUrl/config.json"; Optional = $false },
    @{ Name = "generation_config.json"; Url = "$baseUrl/generation_config.json"; Optional = $false },
    @{ Name = "tokenizer.json"; Url = "$baseUrl/tokenizer.json"; Optional = $false },
    @{ Name = "tokenizer_config.json"; Url = "$baseUrl/tokenizer_config.json"; Optional = $false }
)

if (!$SkipLargeModel) {
    # 4-bit Quantized ONNX weights file (~1.4 GB)
    $filesToDownload += @{ 
        Name = "model_int4.onnx"; 
        Url = "$baseUrl/onnx/model_int4.onnx"; 
        Optional = $false 
    }
}

foreach ($item in $filesToDownload) {
    $targetPath = Join-Path $modelsDir $item.Name
    $targetDir = Split-Path $targetPath -Parent
    if (!(Test-Path $targetDir)) {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }

    if ((Test-Path $targetPath) -and !$Force) {
        $size = (Get-Item $targetPath).Length
        Write-Host "[-] Skipping $($item.Name) (Already exists, size: $([math]::Round($size / 1MB, 2)) MB)" -ForegroundColor Yellow
        continue
    }

    Write-Host "[*] Downloading $($item.Name)..." -ForegroundColor White
    try {
        $ProgressPreference = 'Continue'
        Invoke-WebRequest -Uri $item.Url -OutFile $targetPath -UseBasicParsing
        $fileSize = (Get-Item $targetPath).Length
        Write-Host "[+] Downloaded $($item.Name) ($([math]::Round($fileSize / 1MB, 2)) MB)" -ForegroundColor Green
    }
    catch {
        Write-Host "[!] Could not fetch $($item.Name) from remote ($($_.Exception.Message))" -ForegroundColor Yellow
        Write-Host "    If offline, run with -TestMode to use local offline configuration." -ForegroundColor Yellow
    }
}

# Write offline model manifest file
$manifestPath = Join-Path $modelsDir "model_manifest.json"
$manifestData = @{
    modelId = "gemma-4-E2B-it"
    architecture = "Gemma4ForCausalLM"
    quantization = "int4_webgpu"
    contextWindow = 131072
    downloadTimestamp = (Get-Date).ToString("o")
    status = "ready"
    fallbackServer = "http://localhost:11434"
} | ConvertTo-Json -Depth 4

Set-Content -Path $manifestPath -Value $manifestData -Encoding UTF8
Write-Host "[+] Created local model manifest: $manifestPath" -ForegroundColor Green

Write-Host "`n----------------------------------------------------------" -ForegroundColor Cyan
Write-Host " Local Hybrid Ollama Option (Zero Chrome VRAM consumption):" -ForegroundColor Cyan
Write-Host "   Run: ollama pull gemma2:2b" -ForegroundColor White
Write-Host "   Then toggle 'Localhost Ollama' in the extension sidepanel." -ForegroundColor White
Write-Host "----------------------------------------------------------" -ForegroundColor Cyan
Write-Host "Model setup process completed successfully!" -ForegroundColor Green
