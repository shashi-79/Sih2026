$path = "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\weights\opencv.js"
$content = [System.IO.File]::ReadAllText($path)

$idx = $content.IndexOf("var wasmBinaryFile=""data:application/octet-stream;base64,")
if ($idx -ge 0) {
    $start = $idx + 58
    $end = $content.IndexOf('"', $start)
    $b64 = $content.Substring($start, $end - $start).Trim()
    $rem = $b64.Length % 4
    if ($rem -gt 0) {
        $b64 = $b64.PadRight($b64.Length + (4 - $rem), '=')
    }
    $wasmBytes = [Convert]::FromBase64String($b64)
    Write-Output "WASM binary size: $($wasmBytes.Length) bytes"

    $wasmAscii = [System.Text.Encoding]::ASCII.GetString($wasmBytes)
    $checkList = @("CascadeClassifier", "detectMultiScale", "GaussianBlur", "cvtColor", "Mat", "Canny", "findContours", "threshold", "bilateralFilter", "medianBlur")
    foreach ($item in $checkList) {
        $has = $wasmAscii.Contains($item)
        Write-Output "WASM contains '$item': $has"
    }
} else {
    Write-Output "wasmBinaryFile not found"
}
