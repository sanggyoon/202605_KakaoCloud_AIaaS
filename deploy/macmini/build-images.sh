#!/usr/bin/env bash
# 맥미니 앱 이미지 3개 빌드. 사용(레포 어디서든): bash deploy/macmini/build-images.sh
# FE 빌드인자(NEXT_PUBLIC_*)는 supabase/.env에서 읽음.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"        # repo root
ENVF="$ROOT/deploy/macmini/supabase/.env"
[ -f "$ENVF" ] || { echo ".env 없음: $ENVF"; exit 1; }

U=$(grep '^NEXT_PUBLIC_SUPABASE_URL='      "$ENVF" | head -1 | cut -d= -f2-)
A=$(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' "$ENVF" | head -1 | cut -d= -f2-)
echo "FE build args: URL=$U  ANON_len=${#A}"
[ -n "$U" ] && [ -n "$A" ] || { echo "NEXT_PUBLIC_* 비어있음 — .env 확인"; exit 1; }

echo "[1/3] frontend"
docker build --build-arg NEXT_PUBLIC_SUPABASE_URL="$U" --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$A" -t peakly-frontend:latest "$ROOT/4K_FE"
echo "[2/3] backend"
docker build -t peakly-backend:latest "$ROOT/4K_BE"
echo "[3/3] understand"
docker build -t peakly-understand:latest "$ROOT/understand-dashboard"

echo "== 빌드 완료 =="; docker images | grep peakly-
