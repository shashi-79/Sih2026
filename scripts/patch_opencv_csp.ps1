$path = "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\weights\opencv.js"
$content = [System.IO.File]::ReadAllText($path)

# Target 1: createNamedFunction
$target1 = 'function createNamedFunction(name,body){name=makeLegalFunctionName(name);return new Function("body","return function "+name+"() {\n"+''    "use strict";''+"    return body.apply(this, arguments);\n"+"};\n")(body)}'
$replace1 = 'function createNamedFunction(name,body){return function(){"use strict";return body.apply(this,arguments);}}'

# Target 2: makeDynCaller
$target2 = 'return new Function("dynCall","rawFunction",body)(dynCall,rawFunction)'
$replace2 = 'return function(){return dynCall.apply(null,[rawFunction].concat(Array.prototype.slice.call(arguments)));}'

if ($content.Contains($target1)) {
    $content = $content.Replace($target1, $replace1)
    Write-Output "Patched createNamedFunction successfully."
} else {
    Write-Warning "Target 1 not found exact match!"
}

if ($content.Contains($target2)) {
    $content = $content.Replace($target2, $replace2)
    Write-Output "Patched makeDynCaller successfully."
} else {
    Write-Warning "Target 2 not found exact match!"
}

[System.IO.File]::WriteAllText($path, $content)
Write-Output "Done. Checking for remaining 'new Function'..."
$m = [regex]::Matches($content, 'new Function')
Write-Output "Remaining 'new Function' count: $($m.Count)"
