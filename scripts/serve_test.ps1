$port = 5000
$root = "c:\Users\anamika sakal\Downloads\shashi\Sih\test"

$ip = [System.Net.IPAddress]::Loopback
$listener = New-Object System.Net.Sockets.TcpListener($ip, $port)
$listener.Start()

Write-Output "Test server active at: http://localhost:$port/benchmark.html"

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        $stream = $client.GetStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $writer = New-Object System.IO.BinaryWriter($stream)

        $line = $reader.ReadLine()
        if ($line) {
            $parts = $line.Split(' ')
            $path = $parts[1].TrimStart('/')
            if ([string]::IsNullOrEmpty($path)) { $path = "benchmark.html" }
            $file = Join-Path $root $path

            if (Test-Path $file -PathType Leaf) {
                $content = [System.IO.File]::ReadAllBytes($file)
                $type = if ($file.EndsWith(".html")) { "text/html; charset=utf-8" } elseif ($file.EndsWith(".js")) { "application/javascript" } else { "text/plain" }
                $header = "HTTP/1.1 200 OK`r`nContent-Type: $type`r`nContent-Length: $($content.Length)`r`nAccess-Control-Allow-Origin: *`r`nConnection: close`r`n`r`n"
                $hBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
                $writer.Write($hBytes)
                $writer.Write($content)
            } else {
                $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
                $header = "HTTP/1.1 404 Not Found`r`nContent-Length: $($msg.Length)`r`nConnection: close`r`n`r`n"
                $writer.Write([System.Text.Encoding]::ASCII.GetBytes($header))
                $writer.Write($msg)
            }
        }
        $writer.Flush()
        $client.Close()
    }
} finally {
    $listener.Stop()
}
