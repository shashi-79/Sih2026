$ErrorActionPreference = "Stop"

$workspaceRoot = Split-Path $PSScriptRoot -Parent
$extensionDir = Join-Path $workspaceRoot "extension"

$files = @(
    (Join-Path $extensionDir "manifest.json"),
    (Join-Path $extensionDir "background\service-worker.js"),
    (Join-Path $extensionDir "background\cdp_controller.js"),
    (Join-Path $extensionDir "content\content-script.js"),
    (Join-Path $extensionDir "content\playwright_driver.js"),
    (Join-Path $extensionDir "offscreen\offscreen.js"),
    (Join-Path $extensionDir "orchestrator\event_bus.js"),
    (Join-Path $extensionDir "orchestrator\memory_layer.js"),
    (Join-Path $extensionDir "orchestrator\gemma4_runner.js"),
    (Join-Path $extensionDir "orchestrator\agent_controller.js"),
    (Join-Path $extensionDir "sidepanel\voice_controller.js"),
    (Join-Path $extensionDir "sidepanel\sidepanel.js"),
    (Join-Path $extensionDir "sidepanel\permission.js")
)

$hasErrors = $false

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Gemma 4 Browser Extension - File & Syntax Validation" -ForegroundColor Cyan
Write-Host " Target Directory: $extensionDir" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

foreach ($f in $files) {
    if (!(Test-Path $f)) {
        Write-Host "[!] Missing file: $f" -ForegroundColor Red
        $hasErrors = $true
        continue
    }

    $ext = [System.IO.Path]::GetExtension($f).ToLower()
    $name = [System.IO.Path]::GetFileName($f)

    if ($ext -eq ".json") {
        try {
            $content = Get-Content $f -Raw
            $null = ConvertFrom-Json $content
            Write-Host "[+] VALID JSON: $name" -ForegroundColor Green
        } catch {
            Write-Host "[X] INVALID JSON: $name - $($_.Exception.Message)" -ForegroundColor Red
            $hasErrors = $true
        }
        continue
    }

    if ($ext -eq ".js") {
        $code = [System.IO.File]::ReadAllText($f)
        $openBrace = ($code.ToCharArray() | Where-Object { $_ -eq '{' }).Count
        $closeBrace = ($code.ToCharArray() | Where-Object { $_ -eq '}' }).Count
        $openParen = ($code.ToCharArray() | Where-Object { $_ -eq '(' }).Count
        $closeParen = ($code.ToCharArray() | Where-Object { $_ -eq ')' }).Count
        $openBracket = ($code.ToCharArray() | Where-Object { $_ -eq '[' }).Count
        $closeBracket = ($code.ToCharArray() | Where-Object { $_ -eq ']' }).Count

        if ($openBrace -ne $closeBrace -or $openParen -ne $closeParen -or $openBracket -ne $closeBracket) {
            $hasErrors = $true
            Write-Host "[X] $name : Braces: { $openBrace vs } $closeBrace | Parens: ( $openParen vs ) $closeParen | Brackets: [ $openBracket vs ] $closeBracket" -ForegroundColor Red
        } else {
            Write-Host "[+] $name (Balanced tokens: { } $openBrace, ( ) $openParen, [ ] $openBracket)" -ForegroundColor Green
        }
    }
}

if ($hasErrors) {
    Write-Host "`nValidation failed with errors!" -ForegroundColor Red
    exit 1
} else {
    Write-Host "`nAll extension files verified successfully with zero errors." -ForegroundColor Green
    exit 0
}
