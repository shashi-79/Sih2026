$path = "c:\Users\anamika sakal\Downloads\shashi\Sih\extension\weights\opencv.js"
$content = [System.IO.File]::ReadAllText($path)

$target = 'params.push(functionBody);var invokerFunction=new_(Function,params).apply(null,args);return __emval_addMethodCaller(invokerFunction)'
$replace = 'var invokerFunction=function(handle,name,destructors,argsPtr){var cArgs=[];var off=0;for(var i=0;i<argCount-1;++i){cArgs.push(types[i+1].readValueFromPointer(argsPtr+off));off+=types[i+1]["argPackAdvance"];}var rv=handle[name].apply(handle,cArgs);return retType.isVoid?undefined:retType.toWireType(destructors,rv);};return __emval_addMethodCaller(invokerFunction)'

if ($content.Contains($target)) {
    $content = $content.Replace($target, $replace)
    [System.IO.File]::WriteAllText($path, $content)
    Write-Output "Successfully patched __emval_get_method_caller to eliminate new_(Function, params)!"
} else {
    Write-Warning "Could not find exact target string for __emval_get_method_caller"
}
