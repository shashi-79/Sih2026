$path = "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\weights\opencv.js"
$content = [System.IO.File]::ReadAllText($path)

function Search-Pattern($name, $pattern) {
    Write-Output "=== Search: $name ==="
    $regex = [regex]$pattern
    $matches = $regex.Matches($content)
    Write-Output "Found $($matches.Count) matches"
    foreach ($m in $matches | Select-Object -First 10) {
        $idx = $m.Index
        $start = [Math]::Max(0, $idx - 40)
        $len = [Math]::Min(120, $content.Length - $start)
        Write-Output "[$idx]: " + $content.Substring($start, $len)
    }
}

Search-Pattern "new Function" "new\s+Function\s*\("
Search-Pattern "eval(" "[^\w]eval\s*\("
