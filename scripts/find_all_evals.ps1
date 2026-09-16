Get-ChildItem -Path "c:\Users\anamika sakal\Downloads\shashi\Sih\extension" -Recurse -Include *.js,*.html | ForEach-Object {
    $file = $_.FullName
    if ($file -like "*opencv.js") { return }
    $content = [System.IO.File]::ReadAllText($file)
    $evalMatches = [regex]::Matches($content, "(eval\s*\(|new\s+Function|setTimeout\s*\(\s*['`""]|setInterval\s*\(\s*['`""])")
    if ($evalMatches.Count -gt 0) {
        Write-Output "File: $file"
        foreach ($m in $evalMatches) {
            Write-Output "  Found: $($m.Value) at index $($m.Index)"
        }
    }
}
