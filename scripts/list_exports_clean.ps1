$path = "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\weights\opencv.js"
$content = [System.IO.File]::ReadAllText($path)

$regex = [regex]'Module\["([a-zA-Z0-9_]+)"\]\s*='
$matches = $regex.Matches($content)
$set = [System.Collections.Generic.HashSet[string]]::new()
foreach ($m in $matches) {
    $v = $m.Groups[1].Value
    if (!$v.StartsWith("_") -and !$v.StartsWith("dynCall")) {
        $set.Add($v) | Out-Null
    }
}
$list = $set | Sort-Object
Write-Output "User-facing Module exports ($($list.Count)):"
Write-Output ($list -join ", ")
