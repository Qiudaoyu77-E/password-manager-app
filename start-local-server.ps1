$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$url = "http://localhost:8787"
$edge = "$env:ProgramFiles (x86)\Microsoft\Edge\Application\msedge.exe"
$edgeAlt = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"

function Open-VaultApp {
  if (Test-Path $edge) {
    Start-Process $edge -ArgumentList "--app=$url"
    return
  }
  if (Test-Path $edgeAlt) {
    Start-Process $edgeAlt -ArgumentList "--app=$url"
    return
  }
  Start-Process $url
}

try {
  Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 | Out-Null
  Open-VaultApp
  Write-Host "密码管理工具已经在运行： $url"
  exit 0
} catch {
  Write-Host "密码管理工具已启动： $url"
  Start-Process python -ArgumentList "-m", "http.server", "8787", "--bind", "127.0.0.1" -WorkingDirectory $root -WindowStyle Hidden
  for ($i = 0; $i -lt 20; $i++) {
    try {
      Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 1 | Out-Null
      break
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  Open-VaultApp
}
