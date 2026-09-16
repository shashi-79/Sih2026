$path = "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\weights\opencv.js"
$content = [System.IO.File]::ReadAllText($path)

$terms = @("CascadeClassifier", "detectMultiScale", "cvtColor", "imread", "COLOR_RGBA2GRAY", "RectVector", "Mat")
foreach ($t in $terms) {
    $found = $content.Contains($t)
    Write-Output "Term '$t': $found"
}
