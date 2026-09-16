$path = "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\weights\opencv.js"
$content = [System.IO.File]::ReadAllText($path)

$idx = 0
while (($idx = $content.IndexOf("Function(", $idx)) -ge 0) {
    Write-Output "Found Function( at $idx : " + $content.Substring([Math]::Max(0, $idx - 30), [Math]::Min(100, $content.Length - $idx))
    $idx += 10
}
$idx = 0
while (($idx = $content.IndexOf("Function.", $idx)) -ge 0) {
    Write-Output "Found Function. at $idx : " + $content.Substring([Math]::Max(0, $idx - 30), [Math]::Min(100, $content.Length - $idx))
    $idx += 10
}
