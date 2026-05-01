$ErrorActionPreference = "Stop"

$port = 5173
$webRoot = Join-Path $PSScriptRoot "onhugbahtochnow.sbs"

if (-not (Test-Path -LiteralPath $webRoot)) {
  Write-Host "Pasta nao encontrada: $webRoot"
  exit 1
}

Push-Location $webRoot
try {
if (Get-Command node -ErrorAction SilentlyContinue) {
  node "$PSScriptRoot\\server.js"
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  python "$PSScriptRoot\\spa_server.py" --port $port --dir $webRoot
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
  py "$PSScriptRoot\\spa_server.py" --port $port --dir $webRoot
} else {
  Write-Host "Node ou Python nao encontrado. Instale o Node para a API PIX ou use outro servidor HTTP."
  exit 1
}
} finally {
  Pop-Location
}
