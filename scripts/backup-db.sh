#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-manual}"
case "$MODE" in
  manual|daily|predeploy) ;;
  *) echo "usage: $0 [manual|daily|predeploy]" >&2; exit 2 ;;
esac

BASE="${AIRACM_BASE:-/home/ubuntu/airacm}"
CURRENT="${AIRACM_CURRENT:-$BASE/current}"
BACKUP_DIR="${AIRACM_BACKUP_DIR:-$BASE/db-backups}"
MAX_DIR_MB="${AIRACM_BACKUP_MAX_DIR_MB:-5120}"
TARGET_FREE_MB="${AIRACM_BACKUP_TARGET_FREE_MB:-8192}"
MIN_FREE_MB="${AIRACM_BACKUP_MIN_FREE_MB:-2048}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

log() {
  printf '[%s] %s\n' "$(date '+%F %T %Z')" "$*"
}

disk_free_mb() {
  df -Pm "$BACKUP_DIR" | awk 'NR==2 {print $4}'
}

dir_size_mb() {
  du -sm "$BACKUP_DIR" | awk '{print $1}'
}

remove_backup_file() {
  local f="$1"
  [ -f "$f" ] || return 0
  rm -f -- "$f" "$f.sha256"
}

cleanup_old_with_min_keep() {
  local pattern="$1"
  local days="$2"
  local min_keep="$3"
  mapfile -t files < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name "$pattern" -printf '%T@ %p\n' | sort -n | awk '{sub(/^[^ ]+ /, ""); print}')
  local count="${#files[@]}"
  local cutoff=$(( $(date +%s) - days * 86400 ))
  local f mtime
  for f in "${files[@]}"; do
    [ "$count" -gt "$min_keep" ] || break
    mtime=$(stat -c %Y "$f" 2>/dev/null || echo 0)
    if [ "$mtime" -lt "$cutoff" ]; then
      log "cleanup old backup: $f"
      remove_backup_file "$f"
      count=$((count - 1))
    fi
  done
}

cleanup_by_size() {
  local size oldest
  size=$(dir_size_mb)
  while [ "$size" -gt "$MAX_DIR_MB" ]; do
    oldest=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'airacm-*.sql.gz' -printf '%T@ %p\n' | sort -n | head -1 | awk '{sub(/^[^ ]+ /, ""); print}')
    [ -n "${oldest:-}" ] || break
    log "cleanup size cap backup: $oldest"
    remove_backup_file "$oldest"
    size=$(dir_size_mb)
  done
}

cleanup_if_needed() {
  cleanup_old_with_min_keep 'airacm-daily-*.sql.gz' 14 7
  cleanup_old_with_min_keep 'airacm-weekly-*.sql.gz' 56 4
  cleanup_old_with_min_keep 'airacm-predeploy-*.sql.gz' 14 10
  cleanup_old_with_min_keep 'airacm-manual-*.sql.gz' 7 3
  cleanup_by_size

  local free
  free=$(disk_free_mb)
  if [ "$free" -lt "$TARGET_FREE_MB" ]; then
    log "warning: free disk ${free}MB below target ${TARGET_FREE_MB}MB after cleanup"
  fi
}

cleanup_if_needed
free_before=$(disk_free_mb)
if [ "$free_before" -lt "$MIN_FREE_MB" ]; then
  log "error: free disk ${free_before}MB below minimum ${MIN_FREE_MB}MB; abort backup"
  exit 1
fi

if [ ! -d "$CURRENT" ]; then
  log "error: current release not found: $CURRENT"
  exit 1
fi

stamp="$(date '+%Y%m%d-%H%M%S')"
name="airacm-${MODE}-${stamp}.sql.gz"
tmp="$BACKUP_DIR/.${name}.tmp"
out="$BACKUP_DIR/$name"

log "backup start mode=$MODE out=$out"
cd "$CURRENT"

sudo -n docker compose exec -T db sh -lc '
  set -e
  : "${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD missing}"
  : "${MYSQL_DATABASE:?MYSQL_DATABASE missing}"
  MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump \
    -uroot \
    --single-transaction \
    --quick \
    --routines \
    --triggers \
    --events \
    --no-tablespaces \
    "$MYSQL_DATABASE"
' | gzip -9 > "$tmp"

gzip -t "$tmp"
if [ ! -s "$tmp" ]; then
  log "error: backup file is empty"
  rm -f -- "$tmp"
  exit 1
fi
mv "$tmp" "$out"
sha256sum "$out" > "$out.sha256"
chmod 600 "$out" "$out.sha256"

if [ "$MODE" = "daily" ] && [ "$(date '+%u')" = "7" ]; then
  weekly="$BACKUP_DIR/airacm-weekly-${stamp}.sql.gz"
  cp -p "$out" "$weekly"
  sha256sum "$weekly" > "$weekly.sha256"
  chmod 600 "$weekly" "$weekly.sha256"
  log "weekly copy created: $weekly"
fi

cleanup_if_needed
size=$(du -h "$out" | awk '{print $1}')
free_after=$(disk_free_mb)
log "backup ok file=$out size=$size free_after=${free_after}MB"
