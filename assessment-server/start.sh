#!/bin/sh
set -eu
cd "$(dirname "$0")"
[ -f .env ] || { echo '请先复制 .env.example 为 .env 并设置 AUTH_SECRET'; exit 1; }
npm ci
npm start
