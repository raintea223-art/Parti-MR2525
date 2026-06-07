# Sync code to NAS (preserve data/db) then restart container (no --build).
param(
  [string]$NasIp = "192.168.1.59",
  [string]$Share = "docker",
  [string]$RemotePath = "mr2525-template-catalog",
  [Parameter(Mandatory = $true)][string]$Username,
  [Parameter(Mandatory = $true)][string]$Password
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$DestUnc = "\\$NasIp\$Share\$RemotePath"

Write-Host "== NAS sync + restart (no build) ==" -ForegroundColor Cyan
Write-Host "Target: $DestUnc"

cmdkey /delete:"LegacyGeneric:target=$NasIp" 2>$null | Out-Null
cmdkey /add:$NasIp /user:$Username /pass:$Password | Out-Null
net use "\\$NasIp\$Share" /user:$Username $Password 2>&1 | Out-Null
if (-not (Test-Path $DestUnc)) {
  New-Item -ItemType Directory -Path $DestUnc -Force | Out-Null
}

$Include = @(
  "Dockerfile", "docker-compose.yml", ".dockerignore",
  "package.json", "package-lock.json", "public", "src"
)
foreach ($item in $Include) {
  $src = Join-Path $ProjectRoot $item
  if (-not (Test-Path $src)) { continue }
  Write-Host "  copy $item ..."
  Copy-Item -Path $src -Destination (Join-Path $DestUnc $item) -Recurse -Force
}

$HandbookSrc = Join-Path $ProjectRoot "data\handbook"
if (Test-Path $HandbookSrc) {
  New-Item -ItemType Directory -Path (Join-Path $DestUnc "data") -Force -ErrorAction SilentlyContinue | Out-Null
  Write-Host "  copy data/handbook ..."
  Copy-Item -Path $HandbookSrc -Destination (Join-Path $DestUnc "data\handbook") -Recurse -Force
}

$nasApp = Join-Path $DestUnc "public\app.js"
if (-not (Select-String -Path $nasApp -Pattern "加入颜色列表" -Quiet)) {
  throw "NAS public/app.js still missing panel multi-color UI after copy"
}
Write-Host "Verified: NAS app.js contains 加入颜色列表" -ForegroundColor Green

Import-Module Posh-SSH -ErrorAction Stop
$sec = ConvertTo-SecureString $Password -AsPlainText -Force
$cred = New-Object PSCredential($Username, $sec)
$remote = "/volume1/$Share/$RemotePath"
$dockerCmd = "cd $remote && /usr/local/bin/docker compose up -d && /usr/local/bin/docker compose restart template-catalog"
$escapedPass = $Password.Replace("'", "'\\''")
$cmd = "echo '$escapedPass' | sudo -S sh -c '$dockerCmd'"

Write-Host "SSH: restart container ..." -ForegroundColor Cyan
$ssh = New-SSHSession -ComputerName $NasIp -Credential $cred -AcceptKey -Force
try {
  $r = Invoke-SSHCommand -SessionId $ssh.SessionId -Command $cmd -TimeOut 120
  if ($r.Output) { $r.Output | ForEach-Object { Write-Host $_ } }
  if ($r.Error) {
    $r.Error | Where-Object { $_ -notmatch '^\[sudo\]' -and $_ -ne 'Password:' } |
      ForEach-Object { Write-Host $_ -ForegroundColor Yellow }
  }
  if ($r.ExitStatus -ne 0) { throw "restart failed exit=$($r.ExitStatus)" }
} finally {
  Remove-SSHSession -SessionId $ssh.SessionId | Out-Null
}

Start-Sleep -Seconds 5
$resp = Invoke-WebRequest -Uri "http://${NasIp}:3847" -UseBasicParsing -TimeoutSec 20
Write-Host "HTTP $($resp.StatusCode)" -ForegroundColor Green
if ($resp.Content -notmatch "20260604p1") {
  Write-Host "Warning: index may still be cached; hard-refresh browser (Ctrl+F5)" -ForegroundColor Yellow
}
Write-Host "Done: http://${NasIp}:3847 — check sidebar UI 20260604p1 and 板材 -> 加入颜色列表" -ForegroundColor Green
