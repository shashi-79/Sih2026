$files = @(
    "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\background\service-worker.js",
    "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\content\content-script.js",
    "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\offscreen\offscreen.js",
    "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\sidepanel\sidepanel.js"
)

foreach ($f in $files) {
    $code = [System.IO.File]::ReadAllText($f)
    # Check brace counts
    $openBrace = ($code.ToCharArray() | Where-Object { $_ -eq '{' }).Count
    $closeBrace = ($code.ToCharArray() | Where-Object { $_ -eq '}' }).Count
    $openParen = ($code.ToCharArray() | Where-Object { $_ -eq '(' }).Count
    $closeParen = ($code.ToCharArray() | Where-Object { $_ -eq ')' }).Count
    $openBracket = ($code.ToCharArray() | Where-Object { $_ -eq '[' }).Count
    $closeBracket = ($code.ToCharArray() | Where-Object { $_ -eq ']' }).Count

    Write-Output "File: $([System.IO.Path]::GetFileName($f))"
    Write-Output "  Braces: { $openBrace vs } $closeBrace | Parens: ( $openParen vs ) $closeParen | Brackets: [ $openBracket vs ] $closeBracket"
    if ($openBrace -ne $closeBrace -or $openParen -ne $closeParen -or $openBracket -ne $closeBracket) {
        Write-Warning "MISMATCH IN $f"
    }
}
