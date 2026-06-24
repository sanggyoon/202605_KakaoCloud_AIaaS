#!/usr/bin/env bash
# 맥미니에서 실행 — 컨테이너 supabase-db에 적재: data→public, ai→ai 스키마.
# 사전: deploy/macmini/migrate/{data.dump,ai.dump} 존재, supabase db 컨테이너 가동.
#   사용: bash deploy/macmini/migrate/load-macmini.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"     # .../deploy/macmini/migrate
SUPA="$HERE/../supabase"
cd "$SUPA"
DC="docker compose --env-file .env"

[ -f "$HERE/data.dump" ] || { echo "data.dump 없음: $HERE"; exit 1; }
[ -f "$HERE/ai.dump" ]   || { echo "ai.dump 없음: $HERE"; exit 1; }

echo "[copy] 덤프·grants를 db 컨테이너로"
docker cp "$HERE/data.dump"          supabase-db:/tmp/data.dump
docker cp "$HERE/ai.dump"            supabase-db:/tmp/ai.dump
docker cp "$HERE/grants-macmini.sql" supabase-db:/tmp/grants.sql

echo "[prep] pgvector 확장 보장(public)"
$DC exec -T db bash -c 'PGPASSWORD=$POSTGRES_PASSWORD psql -h 127.0.0.1 -U postgres -d postgres -c "CREATE EXTENSION IF NOT EXISTS vector;"'

echo "[1/3] data → public (직접 복원; 권한/확장 경고는 무시 가능)"
$DC exec -T db bash -c 'PGPASSWORD=$POSTGRES_PASSWORD pg_restore -h 127.0.0.1 -U postgres -d postgres --no-owner --no-privileges /tmp/data.dump' \
  && echo "  data 복원 OK" || echo "  data 복원 경고 있음(아래 검증으로 확인)"

echo "[2/3] ai → ai 스키마 (임시DB rename 방식)"
$DC exec -T db bash -c '
set -e
export PGPASSWORD=$POSTGRES_PASSWORD
P="psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1"
$P -d postgres -c "DROP DATABASE IF EXISTS tmp_ai;"
$P -d postgres -c "CREATE DATABASE tmp_ai;"
$P -d tmp_ai   -c "CREATE EXTENSION IF NOT EXISTS vector;"
pg_restore -h 127.0.0.1 -U postgres -d tmp_ai --no-owner --no-privileges /tmp/ai.dump || true
$P -d tmp_ai   -c "ALTER SCHEMA public RENAME TO ai;"
$P -d postgres -c "DROP SCHEMA IF EXISTS ai CASCADE;"
pg_dump -h 127.0.0.1 -U postgres -d tmp_ai -Fc -n ai | pg_restore -h 127.0.0.1 -U postgres -d postgres --no-owner --no-privileges
$P -d postgres -c "DROP DATABASE tmp_ai;"
echo "  ai 스키마 적재 OK"
'

echo "[3/3] grants 적용"
$DC exec -T db bash -c 'PGPASSWORD=$POSTGRES_PASSWORD psql -h 127.0.0.1 -U postgres -d postgres -f /tmp/grants.sql'

echo "[검증] 스키마별 테이블 수"
$DC exec -T db bash -c 'PGPASSWORD=$POSTGRES_PASSWORD psql -h 127.0.0.1 -U postgres -d postgres -c "SELECT schemaname, count(*) FROM pg_tables WHERE schemaname IN ('"'"'public'"'"','"'"'ai'"'"') GROUP BY 1;"'

echo "[done] data=public, ai=ai 적재 완료."
