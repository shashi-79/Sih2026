$path = "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\weights\opencv.js"
$content = [System.IO.File]::ReadAllText($path)
$idx = 0
while (($idx = $content.IndexOf("onRuntimeInitialized", $idx)) -ge 0) {
    Write-Output "Found at $idx : "
    Write-Output $content.Substring([Math]::Max(0, $idx - 50), [Math]::Min(150, $content.Length - $idx))
    $idx += 20
}
if ($content.IndexOf("onRuntimeInitialized") -lt 0) {
    Write-Output "NOT FOUND: onRuntimeInitialized"
}
