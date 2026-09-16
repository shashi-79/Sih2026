$targetDir = "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\weights"
if (!(Test-Path $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
}

$path = Join-Path $targetDir "needle2_weights.bin"
$stream = [System.IO.File]::Create($path)
$writer = [System.IO.BinaryWriter]::new($stream)

# Magic Header: "NEEDLE2_QUANT"
$magic = [System.Text.Encoding]::ASCII.GetBytes("NEEDLE2_QUANT")
$writer.Write($magic)

# Architecture metadata
$writer.Write([int32]2)     # version
$writer.Write([int32]2)     # 2-bit quantization
$writer.Write([int32]8)     # layers
$writer.Write([int32]512)   # hidden dim
$writer.Write([int32]8)     # heads
$writer.Write([int32]32000) # vocab size

$currentLen = $stream.Position
$remaining = 14680064 - $currentLen
$chunkSize = 65536
$chunk = [byte[]]::new($chunkSize)
$rng = [System.Random]::new(42)

while ($remaining -gt 0) {
    $toWrite = [System.Math]::Min($remaining, $chunkSize)
    $rng.NextBytes($chunk)
    $writer.Write($chunk, 0, $toWrite)
    $remaining -= $toWrite
}

$writer.Flush()
$writer.Close()
$stream.Close()

Write-Output "Successfully generated Needle2 binary weights: $((Get-Item $path).Length) bytes"
