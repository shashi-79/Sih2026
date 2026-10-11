$ErrorActionPreference = "Stop"

$files = @(
    "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\manifest.json",
    "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\background\service-worker.js",
    "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\content\content-script.js",
    "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\content\playwright_driver.js",
    "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\offscreen\offscreen.js",
    "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\orchestrator\event_bus.js",
    "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\orchestrator\memory_layer.js",
    "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\orchestrator\gemma4_runner.js",
    "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\orchestrator\agent_controller.js",
    "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\sidepanel\voice_controller.js",
    "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\sidepanel\sidepanel.js",
    "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\sidepanel\permission.js"
)

$hasErrors = $false

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Gemma 4 Browser Extension - File & Syntax Validation" -ForegroundColor Cyan
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

        $status = "OK"
        if ($openBrace -ne $closeBrace -or $openParen -ne $closeParen -or $openBracket -ne $closeBracket) {
            $status = "MISMATCH"
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
