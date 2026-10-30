# 方块清单 · Craft Check-in — jsdom UI 测试入口
# 用法:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tests/run-ui.ps1
# （本机默认执行策略禁止未签名脚本，需要用 -ExecutionPolicy Bypass；直接无 Bypass 运行会被拦。）
# 依赖: Node + jsdom 30.1.1（默认从 .audit/node_modules 解析，可用环境变量覆盖）

$ErrorActionPreference = 'Stop'

$node = if ($env:EMBER_NODE) { $env:EMBER_NODE } else {
  'C:\Users\Chris\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
}
$jsdomModules = if ($env:EMBER_JSDOM_MODULES) { $env:EMBER_JSDOM_MODULES } else {
  'E:\workspace\paint\.audit\node_modules'
}

if (-not (Test-Path -LiteralPath $node)) {
  Write-Error "找不到 Node 可执行文件: $node（可设置 `$env:EMBER_NODE 覆盖）"
  exit 1
}
$jsdomDir = Join-Path $jsdomModules 'jsdom'
if (-not (Test-Path -LiteralPath $jsdomDir)) {
  Write-Error "找不到 jsdom: $jsdomDir（可设置 `$env:EMBER_JSDOM_MODULES 覆盖）"
  exit 1
}

$testFile = Join-Path $PSScriptRoot 'ui.test.js'
if (-not (Test-Path -LiteralPath $testFile)) {
  Write-Error "找不到测试文件: $testFile"
  exit 1
}

$env:NODE_PATH = $jsdomModules
& $node $testFile
exit $LASTEXITCODE
