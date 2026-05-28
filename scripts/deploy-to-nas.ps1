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

Write-Host "== MR2525 模板库 NAS 部署 ==" -ForegroundColor Cyan
Write-Host "目标: $DestUnc"

if (-not $Username) {
  $Username = Read-Host "群晖 DSM 用户名"
}
if (-not $Password) {
  $sec = Read-Host "群晖 DSM 密码" -AsSecureString
  $Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  )
}

Write-Host "连接共享文件夹..."
cmdkey /delete:"LegacyGeneric:target=$NasIp" 2>$null | Out-Null
cmdkey /add:$NasIp /user:$Username /pass:$Password | Out-Null
net use "\\$NasIp\$Share" /user:$Username $Password 2>&1 | Out-Null

if (-not (Test-Path "\\$NasIp\$Share")) {
  throw "无法访问 \\$NasIp\$Share ，请确认共享文件夹名称（常见: docker / homes / volume1）"
}

if (Test-Path $DestUnc) {
  Write-Host "清理旧目录..."
  Remove-Item -Recurse -Force $DestUnc
}
New-Item -ItemType Directory -Path $DestUnc -Force | Out-Null

$Include = @(
  "Dockerfile",
  "docker-compose.yml",
  ".dockerignore",
  "package.json",
  "package-lock.json",
  "public",
  "src",
  "data"
)

Write-Host "复制项目文件..."
foreach ($item in $Include) {
  $src = Join-Path $ProjectRoot $item
  if (-not (Test-Path $src)) {
    Write-Host "跳过（不存在）: $item" -ForegroundColor Yellow
    continue
  }
  Copy-Item -Path $src -Destination (Join-Path $DestUnc $item) -Recurse -Force
}

Write-Host "文件已上传到 NAS。" -ForegroundColor Green

if ($UseSsh) {
  Write-Host "通过 SSH 构建 Docker 容器..."
  $remote = "/volume1/$Share/$RemotePath".Replace("\\", "/")
  $cmd = "cd '$remote' && sudo docker compose up -d --build"
  ssh -p $SshPort "$Username@$NasIp" $cmd
  Write-Host "完成。访问: http://${NasIp}:3847" -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "下一步（Container Manager 图形界面）：" -ForegroundColor Yellow
  Write-Host "1. 打开 Container Manager -> 项目 -> 新增"
  Write-Host "2. 路径选择: $Share\$RemotePath"
  Write-Host "3. 使用现有 docker-compose.yml -> 构建并启动"
  Write-Host "4. 浏览器访问: http://${NasIp}:3847"
  Write-Host "5. 默认管理员见 docker-compose.yml 中 ADMIN_USERNAME / ADMIN_PASSWORD"
}
