$path = "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\weights\opencv.js"
$content = [System.IO.File]::ReadAllText($path)

function Find-Str($str) {
    $idx = 0
    $count = 0
    while (($idx = $content.IndexOf($str, $idx)) -ge 0) {
        $count++
        if ($count -le 5) {
            Write-Output "[$str] found at $idx : " + $content.Substring([Math]::Max(0, $idx - 30), [Math]::Min(80, $content.Length - $idx))
        }
        $idx += $str.Length
    }
    Write-Output "Total [$str]: $count"
}

Find-Str "setTimeout"
Find-Str "setInterval"
Find-Str "new Function"
Find-Str "eval"
