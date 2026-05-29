param(
  [Parameter(Mandatory = $true)][string]$NasIp = "192.168.1.59",
  [Parameter(Mandatory = $true)][string]$Username,
  [Parameter(Mandatory = $true)][string]$Password,
  [string]$Share = "docker",
  [string]$RemotePath = "mr2525-template-catalog",
  [string]$StageDir = "c:\Users\zl450\Nutstore\1\我的坚果云\Cursor\_nas-deploy-staging\mr2525-template-catalog"
)

$ErrorActionPreference = "Stop"
Import-Module Posh-SSH -ErrorAction Stop

if (-not (Test-Path $StageDir)) {
  throw "Staging directory not found: $StageDir"
}

$sec = ConvertTo-SecureString $Password -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($Username, $sec)

Write-Host "1/4 上传文件到 NAS (SFTP)..." -ForegroundColor Cyan
$session = New-SFTPSession -ComputerName $NasIp -Credential $cred -AcceptKey -Force
try {
  $remoteBase = "/volume1/$Share/$RemotePath"
  foreach ($part in @("/volume1", "/volume1/$Share", $remoteBase)) {
    try { New-SFTPItem -SessionId $session.SessionId -Path $part -ItemType Directory -Force | Out-Null } catch {}
  }

  function Upload-Dir($local, $remote) {
    Get-ChildItem $local -Force | ForEach-Object {
      $r = "$remote/$($_.Name)"
      if ($_.PSIsContainer) {
        try { New-SFTPItem -SessionId $session.SessionId -Path $r -ItemType Directory -Force | Out-Null } catch {}
        Upload-Dir $_.FullName $r
      } else {
        Set-SFTPItem -SessionId $session.SessionId -Path $r -Item $_.FullName -Force | Out-Null
        Write-Host "  uploaded $($_.Name)"
      }
    }
  }

  Get-ChildItem $StageDir -Force | ForEach-Object {
    $r = "$remoteBase/$($_.Name)"
    if ($_.PSIsContainer) {
      try { New-SFTPItem -SessionId $session.SessionId -Path $r -ItemType Directory -Force | Out-Null } catch {}
      Upload-Dir $_.FullName $r
    } else {
      Set-SFTPItem -SessionId $session.SessionId -Path $r -Item $_.FullName -Force | Out-Null
      Write-Host "  uploaded $($_.Name)"
    }
  }
} finally {
  Remove-SFTPSession -SessionId $session.SessionId | Out-Null
}

Write-Host "2/4 SSH 连接..." -ForegroundColor Cyan
$ssh = New-SSHSession -ComputerName $NasIp -Credential $cred -AcceptKey -Force
try {
  $volPath = "/volume1/$Share/$RemotePath"
  $cmds = @(
    "cd '$volPath' && /usr/local/bin/docker compose version || docker compose version",
    "cd '$volPath' && /usr/local/bin/docker compose up -d --build 2>&1 || docker compose up -d --build 2>&1"
  )
  foreach ($c in $cmds) {
    Write-Host ">> $c" -ForegroundColor DarkGray
    $r = Invoke-SSHCommand -SessionId $ssh.SessionId -Command $c -TimeOut 600
    if ($r.Output) { $r.Output | ForEach-Object { Write-Host $_ } }
    if ($r.Error) { $r.Error | ForEach-Object { Write-Host $_ -ForegroundColor Yellow } }
    if ($r.ExitStatus -ne 0 -and $c -match "up -d") {
      throw "Docker 构建失败，ExitStatus=$($r.ExitStatus)"
    }
  }
} finally {
  Remove-SSHSession -SessionId $ssh.SessionId | Out-Null
}

Write-Host "3/4 检查服务..." -ForegroundColor Cyan
Start-Sleep -Seconds 5
try {
  $r = Invoke-WebRequest -Uri "http://${NasIp}:3847" -TimeoutSec 10 -UseBasicParsing
  Write-Host "HTTP $($r.StatusCode) OK" -ForegroundColor Green
} catch {
  Write-Host "服务可能仍在启动，请稍后在浏览器打开 http://${NasIp}:3847" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "部署完成: http://${NasIp}:3847" -ForegroundColor Green
Write-Host "管理员账号见 docker-compose.yml (默认 admin / admin123456，请尽快修改)" -ForegroundColor Yellow
