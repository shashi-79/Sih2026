$path = "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\weights\opencv.js"
$stream = [System.IO.File]::OpenRead($path)
$reader = New-Object System.IO.StreamReader($stream)
$buf = New-Object char[] 1000
$reader.Read($buf, 0, 1000) | Out-Null
Write-Output "--- FIRST 1000 CHARS ---"
Write-Output ([string]::new($buf))

$stream.Seek(-1500, [System.IO.SeekOrigin]::End) | Out-Null
$reader.DiscardBufferedData()
$bufEnd = New-Object char[] 1500
$reader.Read($bufEnd, 0, 1500) | Out-Null
Write-Output "--- LAST 1500 CHARS ---"
Write-Output ([string]::new($bufEnd))

$reader.Close()
$stream.Close()
