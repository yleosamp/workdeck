#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/home/ubuntu/workdeck"
APP_DIR="$APP_ROOT/app"
ENV_FILE="$APP_DIR/.env"

if [[ -e "$ENV_FILE" ]]; then
  echo "O .env do Workdeck já existe; preparação inicial cancelada para não trocar credenciais."
  exit 1
fi

DB_PASSWORD="$(openssl rand -hex 32)"
JWT_SECRET="$(openssl rand -hex 64)"
TURN_SECRET="$(openssl rand -hex 32)"

sudo mariadb --protocol=socket <<SQL
CREATE DATABASE IF NOT EXISTS workdeck CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'workdeck_app'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';
ALTER USER 'workdeck_app'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON workdeck.* TO 'workdeck_app'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

umask 077
{
  printf 'NODE_ENV=production\n'
  printf 'MYSQL_HOST=127.0.0.1\n'
  printf 'MYSQL_PORT=3306\n'
  printf 'MYSQL_USER=workdeck_app\n'
  printf 'MYSQL_PASSWORD=%s\n' "$DB_PASSWORD"
  printf 'MYSQL_DATABASE=workdeck\n'
  printf 'JWT_SECRET=%s\n' "$JWT_SECRET"
  printf 'API_HOST=0.0.0.0\n'
  printf 'API_PORT=8787\n'
  printf 'PUBLIC_API_URL=http://144.22.135.127:8787\n'
  printf 'CLIENT_ORIGINS=tauri://localhost,http://tauri.localhost\n'
  printf 'RELEASES_DIR=/home/ubuntu/workdeck/releases\n'
  printf 'UPDATE_MANIFEST_URL=\n'
  printf 'TURN_URLS=turn:144.22.135.127:3478?transport=udp,turn:144.22.135.127:3478?transport=tcp\n'
  printf 'TURN_SECRET=%s\n' "$TURN_SECRET"
} > "$ENV_FILE"

chmod 600 "$ENV_FILE"
echo "Banco, usuário exclusivo e ambiente do Workdeck preparados."
