#!/usr/bin/env bash
set -euo pipefail

export PATH="/home/ubuntu/workdeck/runtime/node/bin:$PATH"
cd /home/ubuntu/workdeck/app
exec node dist-server/index.js
