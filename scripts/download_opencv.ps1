[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$targetDir = "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\weights"
if (!(Test-Path $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
}

$opencvPath = Join-Path $targetDir "opencv.js"
$cascadePath = Join-Path $targetDir "haarcascade_frontalface_default.xml"

Write-Output "Downloading official OpenCV.js library..."
$opencvUrls = @(
    "https://docs.opencv.org/4.8.0/opencv.js",
    "https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.9.0-release.1/dist/opencv.js",
    "https://cdnjs.cloudflare.com/ajax/libs/opencv.js/4.8.0/opencv.js"
)

$downloaded = $false
foreach ($url in $opencvUrls) {
    try {
        Write-Output "Trying $url ..."
        Invoke-WebRequest -Uri $url -OutFile $opencvPath -UseBasicParsing -TimeoutSec 45
        if ((Test-Path $opencvPath) -and (Get-Item $opencvPath).Length -gt 100000) {
            Write-Output "Successfully downloaded official OpenCV.js: $((Get-Item $opencvPath).Length) bytes"
            $downloaded = $true
            break
        }
    } catch {
        Write-Warning "Failed from $url : $_"
    }
}

if (!$downloaded) {
    Write-Error "Failed to download OpenCV.js from all mirror URLs"
}

Write-Output "Downloading official Haar Cascade XML..."
$cascadeUrl = "https://raw.githubusercontent.com/opencv/opencv/master/data/haarcascades/haarcascade_frontalface_default.xml"
try {
    Invoke-WebRequest -Uri $cascadeUrl -OutFile $cascadePath -UseBasicParsing -TimeoutSec 30
    Write-Output "Successfully downloaded official Haar Cascade: $((Get-Item $cascadePath).Length) bytes"
} catch {
    Write-Warning "Cascade download notice: $_"
}
