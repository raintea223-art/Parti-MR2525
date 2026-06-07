param(
  [string]$NasIp = "192.168.1.59",
  [string]$Username,
  [string]$Password
)
$ErrorActionPreference = "Stop"
if (-not $Username) { $Username = $env:NAS_DEPLOY_USER }
if (-not $Password) { $Password = $env:NAS_DEPLOY_PASS }
if (-not $Username -or -not $Password) { throw "Set NAS_DEPLOY_USER and NAS_DEPLOY_PASS" }

Import-Module Posh-SSH -ErrorAction Stop
$sec = ConvertTo-SecureString $Password -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($Username, $sec)
$remote = "/volume1/docker/mr2525-template-catalog"

$ssh = New-SSHSession -ComputerName $NasIp -Credential $cred -AcceptKey -Force
try {
  # Prefer restart when src/public are volume-mounted; --build often fails on NAS mirror timeout
  $dockerCmd = "cd $remote && /usr/local/bin/docker compose up -d && /usr/local/bin/docker compose restart template-catalog"
  $escapedPass = $Password.Replace("'", "'\\''")
  $cmd = "echo '$escapedPass' | sudo -S sh -c '$dockerCmd'"
  Write-Host ">> docker compose up -d --build"
  $r = Invoke-SSHCommand -SessionId $ssh.SessionId -Command $cmd -TimeOut 900
  if ($r.Output) { $r.Output | ForEach-Object { Write-Host $_ } }
  if ($r.Error) {
    $r.Error | Where-Object { $_ -notmatch '^\[sudo\]' } | ForEach-Object { Write-Host $_ -ForegroundColor Yellow }
  }
  if ($r.ExitStatus -ne 0) { exit $r.ExitStatus }
} finally {
  Remove-SSHSession -SessionId $ssh.SessionId | Out-Null
}

Start-Sleep -Seconds 6
try {
  $resp = Invoke-WebRequest -Uri "http://${NasIp}:3847" -TimeoutSec 15 -UseBasicParsing
  Write-Host "HTTP $($resp.StatusCode)" -ForegroundColor Green
} catch {
  Write-Host "Check http://${NasIp}:3847 manually" -ForegroundColor Yellow
}
