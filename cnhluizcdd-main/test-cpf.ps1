$ErrorActionPreference = "Stop"

$token = "xrvloLltesdxXtaYktklJrir"
$cpf = "11011116901"
$url = "https://completa.workbuscas.com/api?token=$token&modulo=cpf&consulta=$cpf"

try {
  $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20 -Headers @{
    "User-Agent" = "Mozilla/5.0"
  }
  Write-Host $resp.StatusCode
  Write-Host $resp.Content
} catch {
  Write-Host "ERROR"
  Write-Host $_.Exception.Message
  if ($_.Exception.Response -and $_.Exception.Response.GetResponseStream()) {
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    Write-Host ($reader.ReadToEnd())
  }
}
