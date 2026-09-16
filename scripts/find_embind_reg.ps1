$path = "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\weights\opencv.js"
$content = [System.IO.File]::ReadAllText($path)

$idx = 0
$matches = @()
while (($idx = $content.IndexOf("_embind_register_function", $idx)) -ge 0) {
    $matches += $idx
    $idx += 25
}
Write-Output "Found $($matches.Count) occurrences of _embind_register_function"
foreach ($pos in $matches | Select-Object -First 5) {
    Write-Output ("At " + $pos + " : " + $content.Substring([Math]::Max(0, $pos - 20), [Math]::Min(120, $content.Length - $pos)))
}
