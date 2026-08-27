#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/home/ubuntu/workdeck"
APP_DIR="$APP_ROOT/app"
ENV_FILE="$APP_DIR/.env"
TURN_DIR="$APP_ROOT/turn"
TURN_CONFIG="$TURN_DIR/turnserver.conf"
TURN_LOG="$APP_ROOT/logs/turn.log"
PUBLIC_IP="144.22.135.127"
PRIVATE_IP="10.0.0.89"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "O .env do Workdeck não foi encontrado."
  exit 1
fi

if ! command -v turnserver >/dev/null 2>&1; then
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y coturn
fi

# O pacote pode iniciar uma instância genérica. O Workdeck usa sua própria
# configuração e processo visível na screen, conforme o padrão desta VPS.
if systemctl is-active --quiet coturn; then
  sudo systemctl disable --now coturn
fi

mkdir -p "$TURN_DIR" "$APP_ROOT/logs"
chmod 700 "$TURN_DIR"

TURN_SECRET="$(sed -n 's/^TURN_SECRET=//p' "$ENV_FILE" | tail -n 1)"
if [[ -z "$TURN_SECRET" ]]; then
  TURN_SECRET="$(openssl rand -hex 32)"
  printf '\nTURN_SECRET=%s\n' "$TURN_SECRET" >> "$ENV_FILE"
fi

TURN_URLS="turn:${PUBLIC_IP}:3478?transport=udp,turn:${PUBLIC_IP}:3478?transport=tcp"
if grep -q '^TURN_URLS=' "$ENV_FILE"; then
  sed -i "s|^TURN_URLS=.*$|TURN_URLS=${TURN_URLS}|" "$ENV_FILE"
else
  printf 'TURN_URLS=%s\n' "$TURN_URLS" >> "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"

umask 077
{
  printf 'listening-port=3478\n'
  printf 'fingerprint\n'
  printf 'use-auth-secret\n'
  printf 'static-auth-secret=%s\n' "$TURN_SECRET"
  printf 'realm=workdeck\n'
  printf 'server-name=workdeck-turn\n'
  printf 'pidfile=%s/turnserver.pid\n' "$TURN_DIR"
  printf 'external-ip=%s/%s\n' "$PUBLIC_IP" "$PRIVATE_IP"
  printf 'relay-ip=%s\n' "$PRIVATE_IP"
  printf 'min-port=49160\n'
  printf 'max-port=49200\n'
  printf 'stale-nonce=600\n'
  printf 'no-cli\n'
  printf 'no-multicast-peers\n'
  printf 'no-tls\n'
  printf 'no-dtls\n'
} > "$TURN_CONFIG"

sudo firewall-cmd --permanent --zone=public --add-port=3478/tcp
sudo firewall-cmd --permanent --zone=public --add-port=3478/udp
sudo firewall-cmd --permanent --zone=public --add-port=49160-49200/tcp
sudo firewall-cmd --permanent --zone=public --add-port=49160-49200/udp
sudo firewall-cmd --reload

if screen -ls 2>/dev/null | grep -Fq '.workdeck-turn'; then
  echo "O relay TURN já está ativo na screen workdeck-turn."
else
  screen -dmS workdeck-turn bash -lc "exec turnserver -c '$TURN_CONFIG' >> '$TURN_LOG' 2>&1"
  echo "Relay TURN iniciado na screen workdeck-turn."
fi

echo "Configuração TURN gravada sem exibir a chave secreta."
