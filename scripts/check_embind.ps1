$path = "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\weights\opencv.js"
$content = [System.IO.File]::ReadAllText($path)

$terms = @("GaussianBlur", "blur", "medianBlur", "threshold", "Canny", "findContours", "matchTemplate", "adaptiveThreshold", "boxFilter")
foreach ($t in $terms) {
    $found = $content.Contains($t)
    Write-Output "$t : $found"
}
