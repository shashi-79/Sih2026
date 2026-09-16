$path = "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\weights\opencv.js"
$content = [System.IO.File]::ReadAllText($path)

$pattern = '(?i)[^\w]Function\s*\([^\)]*\)'
$matches = [regex]::Matches($content, $pattern)
Write-Output "Total Function( matches: $($matches.Count)"
$seen = @{}
foreach ($m in $matches) {
    $v = $m.Value.Trim()
    if (!$seen.ContainsKey($v)) {
        $seen[$v] = 1
        $idx = $m.Index
        $snippet = $content.Substring([Math]::Max(0, $idx - 30), [Math]::Min(120, $content.Length - $idx + 30))
        Write-Output "--- SNIPPET AT $idx ---"
        Write-Output $snippet
    }
}
