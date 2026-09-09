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

if ($BaseDir -notmatch '^/[A-Za-z0-9._/-]+$') {
  throw "BaseDir must be a plain absolute Linux path"
}
if ($HostName -notmatch '^[A-Za-z0-9.-]+$' -or $User -notmatch '^[A-Za-z0-9_-]+$') {
  throw "Invalid SSH host or user"
}
$dirty = @(git status --porcelain --untracked-files=all)
if ($dirty.Count -gt 0) {
  throw "Working tree must be clean before deployment; git archive only packages HEAD"
}

$sha = (git rev-parse --short HEAD).Trim()
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$release = "airacm-$sha-$stamp"
$package = "$release.tar.gz"
$remote = "$User@$HostName"
$sshOptions = @("-i", $KeyPath, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes")
$backupScript = Join-Path $repo "scripts\backup-db.sh"
if (-not (Test-Path -LiteralPath $backupScript)) {
  throw "Missing backup script: $backupScript"
}

Run git @("archive", "--format=tar.gz", "-o", $package, "HEAD")
try {
  Run ssh ($sshOptions + @($remote, "mkdir -p $BaseDir/releases"))
  Run scp ($sshOptions + @($package, "${remote}:$BaseDir/releases/$package"))
  Run scp ($sshOptions + @($backupScript, "${remote}:/tmp/airacm-backup-db-$release.sh"))

  $remoteScript = @"
set -euo pipefail
BASE="$BaseDir"
PKG="$package"
REL="$release"
mkdir -p "`$BASE/bin"
exec 9>"`$BASE/deploy.lock"
if ! flock -n 9; then
  echo "another deployment is already running" >&2
  exit 1
fi
OLD_RELEASE="`$(readlink -f "`$BASE/current" || true)"
ROLLBACK_API_IMAGE="airacm-api:rollback-`$REL"
ROLLBACK_FRONTEND_IMAGE="airacm-frontend:rollback-`$REL"
if [ -z "`$OLD_RELEASE" ] || [ ! -d "`$OLD_RELEASE" ]; then
  echo "previous release or image metadata is unavailable; refusing a deployment that cannot roll back" >&2
  exit 1
fi
# 原先保存容器的镜像摘要；启用 containerd 镜像存储时，该摘要可能无法再被 docker image tag 引用。
# 构建覆盖 latest 之前先创建明确的回滚标签，保证维护窗口内始终有可启动的旧镜像。
sudo -n docker image tag airacm-api:latest "`$ROLLBACK_API_IMAGE"
if ! sudo -n docker image tag airacm-frontend:latest "`$ROLLBACK_FRONTEND_IMAGE"; then
  sudo -n docker image rm "`$ROLLBACK_API_IMAGE" >/dev/null 2>&1 || true
  exit 1
fi
DEPLOY_OK=0
MAINTENANCE_STARTED=0
rollback() {
  status=`$?
  trap - EXIT
  if [ "`$DEPLOY_OK" != "1" ]; then
    echo "deployment failed; restoring previous image tags..." >&2
    rollback_ok=1
    sudo -n docker image tag "`$ROLLBACK_API_IMAGE" airacm-api:latest || rollback_ok=0
    sudo -n docker image tag "`$ROLLBACK_FRONTEND_IMAGE" airacm-frontend:latest || rollback_ok=0
    if [ "`$rollback_ok" = "1" ] && [ "`$MAINTENANCE_STARTED" = "1" ] && [ -n "`$OLD_RELEASE" ] && [ -d "`$OLD_RELEASE" ]; then
      cd "`$OLD_RELEASE"
      sudo -n env DB_MIGRATIONS_RUN=false docker compose up -d --no-build --force-recreate api frontend nginx || rollback_ok=0
    fi
    rollback_health=""
    if [ "`$rollback_ok" = "1" ] && [ "`$MAINTENANCE_STARTED" = "1" ]; then
      for i in `$(seq 1 20); do
        rollback_health=`$(curl -k -sS -o /tmp/airacm_rollback_health.out -w "%{http_code}" https://weixiuzhiyi.com.cn/api/health || true)
        [ "`$rollback_health" = "200" ] && break
        sleep 2
      done
      [ "`$rollback_health" = "200" ] || rollback_ok=0
    fi
    if [ "`$rollback_ok" = "1" ]; then
      if [ "`$MAINTENANCE_STARTED" = "1" ]; then
        ln -sfn "`$OLD_RELEASE" "`$BASE/current"
        echo "rollback health check passed; restored `$OLD_RELEASE" >&2
      else
        echo "restored previous image tags; running containers were not changed" >&2
      fi
      sudo -n docker image rm "`$ROLLBACK_API_IMAGE" "`$ROLLBACK_FRONTEND_IMAGE" >/dev/null 2>&1 || true
    else
      echo "ROLLBACK FAILED; current symlink was not changed. Manual recovery is required." >&2
    fi
  fi
  [ "`$status" -ne 0 ] || status=1
  exit "`$status"
}
trap rollback EXIT
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
  # Renewed private keys are intentionally root-owned (0600); copy them with sudo
  # into the new release while preserving their owner and mode.
  sudo -n cp -a "`$BASE/current/deploy/nginx/certs/." deploy/nginx/certs/
fi
# 原先继承 current/uploads 会把“持久”数据继续挂在某个旧发布目录下，清理旧版本时会连带删除上传文件。
# 统一锚定到 BASE 下的真实目录；遇到历史符号链接时拒绝部署，先人工迁移数据。
if [ -L "`$BASE/uploads" ]; then
  echo "Persistent upload root must be a real directory, not a symlink: `$BASE/uploads" >&2
  exit 1
fi
install -d -m 775 "`$BASE/uploads/app" "`$BASE/uploads/question-images" "`$BASE/uploads/question-imports" "`$BASE/uploads/customer-service"
ln -s "`$BASE/uploads" uploads
if [ -f frontend/public/downloads/app/airacm-android.apk ]; then
  mkdir -p uploads/app
  cp -f frontend/public/downloads/app/airacm-android.apk uploads/app/airacm-android.apk
fi
echo "release=`$PWD"

"@

  $remoteScript += @"
echo "building release images before database maintenance..."
sudo -n docker compose build

echo "preparing migration dependencies before maintenance..."
sudo -n docker run --rm --network airacm_default --env-file .env -e NODE_ENV=production -v "`$PWD/backend-pre:/work" -w /work node:22-slim sh -lc "npm config set registry https://registry.npmmirror.com && npm ci --omit=optional --ignore-scripts"

run_migration_preflight() {
  phase="`$1"
  echo "running read-only migration preflight (`$phase)..."
  preflight=`$(sudo -n docker compose exec -T db sh -lc 'mysql -N -u"`$MYSQL_USER" -p"`$MYSQL_PASSWORD" "`$MYSQL_DATABASE"' <<'SQL'
SELECT CONCAT_WS(' ',
  (SELECT COUNT(*) FROM (
    SELECT tenantId, openid FROM user
    WHERE openid IS NOT NULL AND openid NOT LIKE 'key:%' AND openid NOT LIKE 'dev-openid-%'
      AND openid REGEXP '^[A-Za-z0-9_-]{8,128}$'
    GROUP BY tenantId, openid HAVING COUNT(*) > 1
  ) duplicate_openids),
  (SELECT COUNT(*) FROM user
    WHERE openid IS NOT NULL AND openid NOT LIKE 'key:%' AND openid NOT LIKE 'dev-openid-%'
      AND openid NOT REGEXP '^[A-Za-z0-9_-]{8,128}$'),
  (SELECT COUNT(*) FROM user u
    WHERE u.openid IS NOT NULL AND u.openid NOT LIKE 'key:%' AND u.openid NOT LIKE 'dev-openid-%'
      AND u.openid REGEXP '^[A-Za-z0-9_-]{8,128}$'
      AND EXISTS (SELECT 1 FROM access_key k WHERE k.tenantId = u.tenantId AND k.userId = u.id)),
  (SELECT COUNT(*) FROM (
    SELECT tenantId, nickname FROM user GROUP BY tenantId, nickname HAVING COUNT(*) > 1
  ) duplicate_nicknames),
  (SELECT COUNT(*) FROM exam_attempt e
    JOIN JSON_TABLE(e.questionIds, '`$[*]' COLUMNS(questionId VARCHAR(36) PATH '`$')) ids
    LEFT JOIN question q ON q.tenantId = e.tenantId AND q.id = ids.questionId
    LEFT JOIN JSON_TABLE(
      CASE WHEN JSON_VALID(e.questionSnapshots) THEN e.questionSnapshots ELSE JSON_ARRAY() END,
      '`$[*]' COLUMNS(snapshot JSON PATH '`$', snapshotId VARCHAR(36) PATH '`$.id')
    ) snap ON snap.snapshotId = ids.questionId
    WHERE q.id IS NULL
      -- 整包替换会删除旧题；有完整快照的历史考试可安全复盘，只有缺题且缺快照才阻断部署。
      -- MySQL 会错误改写这里原先的相关 NOT EXISTS，使 424 条完整快照被误报；改用显式横向连接。
      AND (
        snap.snapshotId IS NULL
        OR JSON_CONTAINS_PATH(
          snap.snapshot,
          'all',
          '`$.id', '`$.stem', '`$.options', '`$.answer', '`$.analysis', '`$.imageUrls', '`$.stemImageUrls'
        ) <> 1
        OR COALESCE(JSON_LENGTH(JSON_EXTRACT(snap.snapshot, '`$.options')), 0) = 0
      ))
  );
SQL
  )
  read -r duplicate_openids malformed_openids source_conflicts duplicate_nicknames missing_questions <<< "`$preflight"
  if [ "`$duplicate_openids" != "0" ] || [ "`$malformed_openids" != "0" ] || [ "`$source_conflicts" != "0" ] || [ "`$duplicate_nicknames" != "0" ] || [ "`$missing_questions" != "0" ]; then
    echo "migration preflight failed (`$phase): duplicateOpenids=`$duplicate_openids malformedOpenids=`$malformed_openids sourceConflicts=`$source_conflicts duplicateNicknames=`$duplicate_nicknames missingQuestions=`$missing_questions" >&2
    return 1
  fi
}

run_migration_preflight online

echo "stopping API for a consistent predeploy backup..."
MAINTENANCE_STARTED=1
sudo -n docker compose stop api
run_migration_preflight stopped

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
sudo -n docker run --rm --network airacm_default --env-file .env -e NODE_ENV=production -v "`$PWD/backend-pre:/work" -w /work node:22-slim sh -lc "npm run migration:run"

"@
  }

  $remoteScript += @"
echo "starting the prebuilt release..."
sudo -n env DB_MIGRATIONS_RUN=false docker compose up -d --no-build
sudo -n docker compose ps
health_code=""
for i in `$(seq 1 20); do
  health_code=`$(curl -k -sS -o /tmp/airacm_health.out -w "%{http_code}" https://weixiuzhiyi.com.cn/api/health || true)
  echo "public_health try=`$i code=`$health_code"
  [ "`$health_code" = "200" ] && break
  sleep 2
done
cat /tmp/airacm_health.out
if [ "`$health_code" != "200" ]; then
  echo "health check failed after deploy" >&2
  sudo -n docker compose logs --tail=120 api >&2 || true
  sudo -n docker compose logs --tail=80 nginx >&2 || true
  exit 1
fi
ln -sfn "`$PWD" "`$BASE/current"
echo "current -> `$(readlink "`$BASE/current")"
DEPLOY_OK=1
sudo -n docker image rm "`$ROLLBACK_API_IMAGE" "`$ROLLBACK_FRONTEND_IMAGE" >/dev/null 2>&1 || true
trap - EXIT

"@

  $tmp = Join-Path $env:TEMP "airacm-deploy-$release.sh"
  $remoteScript = $remoteScript.Replace("`r`n", "`n")
  [System.IO.File]::WriteAllText($tmp, $remoteScript, [System.Text.UTF8Encoding]::new($false))
  Run scp ($sshOptions + @($tmp, "${remote}:/tmp/airacm-deploy-$release.sh"))
  Run ssh ($sshOptions + @($remote, "bash /tmp/airacm-deploy-$release.sh"))
} finally {
  Remove-Item -LiteralPath $package -ErrorAction SilentlyContinue
}
