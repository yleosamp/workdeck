#!/usr/bin/env bash
set -euo pipefail

CRON_LINE='@reboot sleep 20 && /home/ubuntu/workdeck/app/scripts/garantir-backend-vps.sh'
CRON_TEMP="$(mktemp)"
trap 'rm -f "$CRON_TEMP"' EXIT

crontab -l > "$CRON_TEMP" 2>/dev/null || true
if ! grep -Fqx "$CRON_LINE" "$CRON_TEMP"; then
  printf '%s\n' "$CRON_LINE" >> "$CRON_TEMP"
  crontab "$CRON_TEMP"
fi

echo "Inicialização automática da screen workdeck registrada."
