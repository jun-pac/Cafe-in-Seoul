#!/bin/bash
# Off-host backup to Cloudflare R2 via rclone. Run from host cron (NOT the container).
#
# What it sends:
#   - uploads/ (photos)   -> R2 .../uploads   (photos are immutable/unique names, so
#                                               `copy` only transfers new files — cheap)
#   - daily DB snapshots  -> R2 .../db         (app-daily-*.db, already checkpointed by db.js)
#
# `copy` (not `sync`) never deletes on R2, so R2 keeps history even after local pruning.
# Credentials live ONLY in rclone's config (~/.config/rclone/rclone.conf, chmod 600) —
# never in this file or in git.
set -euo pipefail

export PATH="/home/sejun/bin:$PATH"
APP="/home/sejun/QuietPlaceSeoul"
REMOTE="${R2_REMOTE:-r2:cafe-in-seoul-backup}"   # rclone <remote>:<bucket>
ts() { date -u +%FT%TZ; }

if ! command -v rclone >/dev/null 2>&1; then echo "$(ts) ERROR rclone not found" >&2; exit 1; fi

# 1) photos — incremental copy
rclone copy "$APP/uploads" "$REMOTE/uploads" --transfers 8 --checkers 16 --fast-list --stats-one-line --s3-no-check-bucket

# 2) daily DB snapshots (consistent copies made by server/db.js backupNow)
rclone copy "$APP/data/backups" "$REMOTE/db" --include "app-daily-*.db" --fast-list --stats-one-line --s3-no-check-bucket

# 3) bound R2 storage / cost: drop DB snapshots older than 90 days on R2 (photos are
#    kept forever — they're the point of the backup and immutable). Keeps us well
#    inside the 10GB free tier no matter how long this runs.
rclone delete "$REMOTE/db" --min-age 90d --include "app-daily-*.db" --s3-no-check-bucket

echo "$(ts) r2 backup ok"
