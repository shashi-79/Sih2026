$path = "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\weights\opencv.js"
$content = [System.IO.File]::ReadAllText($path)

$regex = [regex]'Module\["([a-zA-Z0-9_]+)"\]\s*='
$matches = $regex.Matches($content)
$set = [System.Collections.Generic.HashSet[string]]::new()
foreach ($m in $matches) {
    $set.Add($m.Groups[1].Value) | Out-Null
}
Write-Output "Total Module exports: $($set.Count)"
$sample = $set | Sort-Object | Select-Object -First 60
Write-Output ($sample -join ", ")
