#!/usr/bin/env bash
set -euo pipefail

if curl -fsS --max-time 3 http://127.0.0.1:8787/health >/dev/null 2>&1; then
  exit 0
fi

if screen -ls 2>/dev/null | grep -Fq '.workdeck'; then
  echo "A screen workdeck já existe, mas a API ainda não respondeu."
  exit 1
fi

screen -dmS workdeck bash -lc "/home/ubuntu/workdeck/app/scripts/iniciar-backend-vps.sh >> /home/ubuntu/workdeck/logs/api.log 2>&1"
