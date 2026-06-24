#!/usr/bin/env bash
# 카카오 가동 중 1회 실행 — 서비스/AI DB를 각각 덤프(스키마+데이터+함수+RLS).
# 필요: KAKAO_DATA_DSN, KAKAO_AI_DSN (예: postgresql://user:pass@host:5432/postgres)
#   카카오 Postgres 접근(포트포워딩/터널) 선행. pgvector 확장은 대상에서 별도 생성.
set -euo pipefail

: "${KAKAO_DATA_DSN:?KAKAO_DATA_DSN 필요}"
: "${KAKAO_AI_DSN:?KAKAO_AI_DSN 필요}"

cd "$(dirname "$0")"

echo "[1/2] data DB (public) → data.dump"
pg_dump "$KAKAO_DATA_DSN" --schema=public --no-owner --no-privileges -Fc -f data.dump

echo "[2/2] ai DB (public) → ai.dump"
pg_dump "$KAKAO_AI_DSN" --schema=public --no-owner --no-privileges -Fc -f ai.dump

echo "완료: $(ls -la data.dump ai.dump)"
