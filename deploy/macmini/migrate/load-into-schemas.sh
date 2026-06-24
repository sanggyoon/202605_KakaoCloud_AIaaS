#!/usr/bin/env bash
# 맥미니 Supabase Postgres에 적재: data.dump → svc 스키마, ai.dump → ai 스키마.
# 방식: 임시 DB에 복원 → public을 대상 스키마로 rename → 그 스키마만 다시 덤프 → 본 DB에 적재.
#       (본 DB의 public을 건드리지 않음)
# 필요: MACMINI_DSN (예: postgresql://postgres:PW@localhost:5432/postgres)
set -euo pipefail

: "${MACMINI_DSN:?MACMINI_DSN 필요}"
cd "$(dirname "$0")"

# 임시DB 접속용 base (DSN에서 dbname만 교체)
base="${MACMINI_DSN%/*}"   # .../postgres → .../  앞부분
admin_db="${MACMINI_DSN##*/}"  # postgres

load_one() {
  local dump="$1" schema="$2" tmp="tmp_${schema}"
  echo "== $dump → schema '$schema' (임시DB $tmp 경유) =="
  psql "$MACMINI_DSN" -c "DROP DATABASE IF EXISTS $tmp;"
  psql "$MACMINI_DSN" -c "CREATE DATABASE $tmp;"
  local tmp_dsn="${base}/${tmp}"
  psql "$tmp_dsn" -c "CREATE EXTENSION IF NOT EXISTS vector;"
  pg_restore -d "$tmp_dsn" --no-owner --no-privileges "$dump" || true   # 일부 권한/확장 경고 무시
  psql "$tmp_dsn" -c "ALTER SCHEMA public RENAME TO $schema;"
  pg_dump -Fc -n "$schema" "$tmp_dsn" -f "${schema}.schema.dump"
  # 본 DB에 적재 (대상 스키마 새로)
  psql "$MACMINI_DSN" -c "DROP SCHEMA IF EXISTS $schema CASCADE;"
  psql "$MACMINI_DSN" -c "CREATE EXTENSION IF NOT EXISTS vector;"
  pg_restore -d "$MACMINI_DSN" --no-owner --no-privileges "${schema}.schema.dump"
  psql "$MACMINI_DSN" -c "DROP DATABASE $tmp;"
  echo "   '$schema' 적재 완료"
}

load_one data.dump svc
load_one ai.dump   ai

echo "다음: psql \"\$MACMINI_DSN\" -f grants.sql"
