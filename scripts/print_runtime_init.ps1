$path = "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\weights\opencv.js"
$content = [System.IO.File]::ReadAllText($path)
$idx = 9984000
Write-Output $content.Substring($idx, 1000)
