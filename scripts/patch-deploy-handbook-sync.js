const fs = require("fs");
const path = require("path");
const p = path.join(__dirname, "deploy-to-nas.ps1");
let s = fs.readFileSync(p, "utf8");
if (s.includes("data\\handbook")) {
  console.log("already patched");
  process.exit(0);
}
const needle = 'Write-Host "Files uploaded to NAS." -ForegroundColor Green';
const insert = `$HandbookSrc = Join-Path $ProjectRoot "data\\handbook"
if (Test-Path $HandbookSrc) {
  $HandbookDest = Join-Path $DestUnc "data\\handbook"
  New-Item -ItemType Directory -Path (Join-Path $DestUnc "data") -Force -ErrorAction SilentlyContinue | Out-Null
  Copy-Item -Path $HandbookSrc -Destination $HandbookDest -Recurse -Force
  Write-Host "Synced data/handbook (brand + design-system)."
}

Write-Host "Files uploaded to NAS." -ForegroundColor Green`;
if (!s.includes(needle)) {
  console.error("anchor not found");
  process.exit(1);
}
s = s.replace(needle, insert);
fs.writeFileSync(p, s, "utf8");
console.log("deploy-to-nas.ps1 updated");
