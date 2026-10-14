Stop-Process -Name "ollama*" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
$env:OLLAMA_ORIGINS = "*"
[System.Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", "*", "User")
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "C:\Users\anamika sakal\AppData\Local\Programs\Ollama\ollama.exe"
$psi.Arguments = "serve"
$psi.UseShellExecute = $false
$psi.EnvironmentVariables["OLLAMA_ORIGINS"] = "*"
$psi.CreateNoWindow = $true
$psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
[System.Diagnostics.Process]::Start($psi) | Out-Null

Start-Sleep -Seconds 3

# Test with curl Origin header
curl.exe -i -H "Origin: chrome-extension://testextensionid" http://127.0.0.1:11434/api/tags
