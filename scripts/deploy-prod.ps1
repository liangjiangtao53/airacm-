param(
  [string]$HostName = "49.235.145.149",
  [string]$User = "ubuntu",
  [string]$KeyPath = "$env:USERPROFILE\.ssh\id_ed25519",
  [string]$BaseDir = "/home/ubuntu/airacm",
  [switch]$SkipMigration
)

$ErrorActionPreference = "Stop"

function Run($File, [string[]]$ArgsList) {
  Write-Host ">> $File $($ArgsList -join ' ')"
  & $File @ArgsList
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $File $($ArgsList -join ' ')"
  }
}

$repo = (git rev-parse --show-toplevel).Trim()
Set-Location $repo

$sha = (git rev-parse --short HEAD).Trim()
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$release = "airacm-$sha-$stamp"
$package = "$release.tar.gz"
$remote = "$User@$HostName"
$backupScript = Join-Path $repo "scripts\backup-db.sh"
if (-not (Test-Path -LiteralPath $backupScript)) {
  throw "Missing backup script: $backupScript"
}

Run git @("archive", "--format=tar.gz", "-o", $package, "HEAD")
try {
  Run ssh @("-i", $KeyPath, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=no", $remote, "mkdir -p $BaseDir/releases")
  Run scp @("-i", $KeyPath, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=no", $package, "${remote}:$BaseDir/releases/$package")
  Run scp @("-i", $KeyPath, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=no", $backupScript, "${remote}:/tmp/airacm-backup-db-$release.sh")

  $remoteScript = @"
set -euo pipefail
BASE="$BaseDir"
PKG="$package"
REL="$release"
mkdir -p "`$BASE/bin"
install -m 700 "/tmp/airacm-backup-db-$release.sh" "`$BASE/bin/backup-db.sh"
cd "`$BASE/releases"
if [ -e "`$REL" ]; then
  echo "Release already exists: `$REL" >&2
  exit 1
fi
mkdir -p "`$REL"
tar -xzf "`$PKG" -C "`$REL"
cd "`$REL"
cp "`$BASE/current/.env" .env
mkdir -p deploy/nginx/certs
if [ -d "`$BASE/current/deploy/nginx/certs" ]; then
  cp -a "`$BASE/current/deploy/nginx/certs/." deploy/nginx/certs/
fi
if [ -L "`$BASE/current/uploads" ]; then
  ln -s "`$(readlink "`$BASE/current/uploads")" uploads
elif [ -d "`$BASE/current/uploads" ]; then
  ln -s "`$BASE/current/uploads" uploads
else
  mkdir -p uploads/app uploads/question-images
fi
echo "release=`$PWD"
"@

  $remoteScript += @"
echo "running predeploy database backup..."
if [ ! -x "`$BASE/bin/backup-db.sh" ]; then
  echo "Missing database backup script: `$BASE/bin/backup-db.sh" >&2
  exit 1
fi
"`$BASE/bin/backup-db.sh" predeploy
"@

  if (-not $SkipMigration) {
    $remoteScript += @"
echo "running migration..."
sudo -n docker run --rm --network airacm_default --env-file .env -e NODE_ENV=production -v "`$PWD/backend-pre:/work" -w /work node:22-slim sh -lc "npm config set registry https://registry.npmmirror.com && npm ci --omit=optional --ignore-scripts && npm run migration:run"
"@
  }

  $remoteScript += @"
echo "building and restarting compose..."
sudo -n docker compose up -d --build
ln -sfn "`$PWD" "`$BASE/current"
echo "current -> `$(readlink "`$BASE/current")"
sudo -n docker compose ps
curl -k -sS -o /tmp/airacm_health.out -w "public_health %{http_code} %{time_total}\n" https://weixiuzhiyi.com.cn/api/health
cat /tmp/airacm_health.out
"@

  $tmp = Join-Path $env:TEMP "airacm-deploy-$release.sh"
  [System.IO.File]::WriteAllText($tmp, $remoteScript, [System.Text.UTF8Encoding]::new($false))
  Run scp @("-i", $KeyPath, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=no", $tmp, "${remote}:/tmp/airacm-deploy-$release.sh")
  Run ssh @("-i", $KeyPath, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=no", $remote, "bash /tmp/airacm-deploy-$release.sh")
} finally {
  Remove-Item -LiteralPath $package -ErrorAction SilentlyContinue
}
