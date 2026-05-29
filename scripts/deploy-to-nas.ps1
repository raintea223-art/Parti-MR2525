param(
  [string]$NasIp = "192.168.1.59",
  [string]$Share = "docker",
  [string]$RemotePath = "mr2525-template-catalog",
  [string]$Username,
  [string]$Password,
  [switch]$UseSsh,
  [int]$SshPort = 22
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$DestUnc = "\\$NasIp\$Share\$RemotePath"

Write-Host "== MR2525 template catalog NAS deploy ==" -ForegroundColor Cyan
Write-Host "Target: $DestUnc"

if (-not $Username) {
  $Username = Read-Host "DSM username"
}
if (-not $Password) {
  $sec = Read-Host "DSM password" -AsSecureString
  $Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  )
}

Write-Host "Connecting SMB share..."
cmdkey /delete:"LegacyGeneric:target=$NasIp" 2>$null | Out-Null
cmdkey /add:$NasIp /user:$Username /pass:$Password | Out-Null
net use "\\$NasIp\$Share" /user:$Username $Password 2>&1 | Out-Null

if (-not (Test-Path "\\$NasIp\$Share")) {
  throw "Cannot access \\$NasIp\$Share"
}

if (-not (Test-Path $DestUnc)) {
  New-Item -ItemType Directory -Path $DestUnc -Force | Out-Null
}

# Code-only sync; never overwrite NAS data/ (catalog.db, uploads)
$Include = @(
  "Dockerfile",
  "docker-compose.yml",
  ".dockerignore",
  "package.json",
  "package-lock.json",
  "public",
  "src"
)

Write-Host "Copying project files (data/ skipped)..."
foreach ($item in $Include) {
  $src = Join-Path $ProjectRoot $item
  if (-not (Test-Path $src)) {
    Write-Host "Skip missing: $item" -ForegroundColor Yellow
    continue
  }
  Copy-Item -Path $src -Destination (Join-Path $DestUnc $item) -Recurse -Force
}

Write-Host "Files uploaded to NAS." -ForegroundColor Green

if ($UseSsh) {
  Write-Host "Rebuilding Docker via SSH..."
  $remote = "/volume1/$Share/$RemotePath"
  $escapedPass = $Password.Replace("'", "'\\''")
  $dockerCmd = "cd $remote && /usr/local/bin/docker compose up -d --build"
  $cmd = "echo '$escapedPass' | sudo -S sh -c '$dockerCmd'"

  if (Get-Module -ListAvailable -Name Posh-SSH) {
    Import-Module Posh-SSH -ErrorAction Stop
    $sec = ConvertTo-SecureString $Password -AsPlainText -Force
    $cred = New-Object System.Management.Automation.PSCredential($Username, $sec)
    $ssh = New-SSHSession -ComputerName $NasIp -Credential $cred -AcceptKey -Force
    try {
      Write-Host ">> docker compose up -d --build" -ForegroundColor DarkGray
      $r = Invoke-SSHCommand -SessionId $ssh.SessionId -Command $cmd -TimeOut 600
      if ($r.Output) { $r.Output | ForEach-Object { Write-Host $_ } }
      if ($r.Error) {
        $r.Error | Where-Object { $_ -notmatch '^\[sudo\] password' -and $_ -ne 'Password:' } |
          ForEach-Object { Write-Host $_ -ForegroundColor Yellow }
      }
      if ($r.ExitStatus -ne 0) { throw "Docker build failed, ExitStatus=$($r.ExitStatus)" }
    } finally {
      Remove-SSHSession -SessionId $ssh.SessionId | Out-Null
    }
  } else {
    throw "Posh-SSH module required for -UseSsh. Run: Install-Module Posh-SSH -Scope CurrentUser"
  }
  Write-Host "Done: http://${NasIp}:3847" -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "Next: Container Manager -> rebuild and start the project" -ForegroundColor Yellow
  Write-Host "URL: http://${NasIp}:3847"
}
