#!/usr/bin/env python3
"""training 스키마 DDL을 Postgres에 적용. schema.sql을 통째로 실행(멱등)."""
import os
import sys

import psycopg


def apply_schema(dsn: str, sql_path: str) -> None:
    """schema.sql 파일을 dsn으로 연결한 Postgres에 실행한다."""
    with open(sql_path, "r", encoding="utf-8") as f:
        sql = f.read()
    # autocommit: DDL을 즉시 반영. 파라미터 없는 멀티스테이트먼트라 한 번에 실행됨.
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute(sql)


if __name__ == "__main__":
    dsn = os.getenv("AI_DATABASE_URL")
    if not dsn:
        sys.exit("AI_DATABASE_URL 환경변수가 필요합니다 (vm5 Postgres 연결 문자열).")
    here = os.path.dirname(__file__)
    apply_schema(dsn, os.path.join(here, "schema.sql"))
    print("✅ training 스키마 적용 완료")
