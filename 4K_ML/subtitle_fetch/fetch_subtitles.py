#!/usr/bin/env python3
"""자막 수집 배치 — vm4 movies 순회, vm5 status 멱등 원장.

env: SUBDL_API_KEY, AI_DATABASE_URL, DATA_SUPABASE_URL, DATA_SUPABASE_KEY
"""
import os
import time

import httpx
import psycopg

from subtitle_fetch import db
from subtitle_fetch import select as sel
from subtitle_fetch import subdl_client as subdl

REQUEST_DELAY = float(os.getenv("SUBDL_REQUEST_DELAY", "0.5"))
MAX_REQUESTS_PER_RUN = int(os.getenv("SUBDL_MAX_PER_RUN", "1800"))


def process_movie(conn, http, tmdb_id: int) -> str:
    """영화 1편 처리. 반환: 'done'|'skipped'|'failed'|'cached'.
    SubdlRateLimit는 호출자가 처리하도록 전파."""
    if db.get_state(conn, tmdb_id) == "done":
        return "cached"
    try:
        chosen = sel.choose(subdl.search(tmdb_id, http))
        if chosen is None:
            db.set_status(conn, tmdb_id, "skipped")
            return "skipped"
        raw_text = subdl.download_and_extract(chosen.get("url") or "", http)
        if not raw_text.strip():
            db.set_status(conn, tmdb_id, "failed", "empty srt")
            return "failed"
        db.save_subtitle(conn, tmdb_id, chosen, raw_text)
        db.set_status(conn, tmdb_id, "done")
        return "done"
    except subdl.SubdlRateLimit:
        raise
    except Exception as e:  # noqa: BLE001 — 어떤 오류든 failed로 기록하고 계속
        db.set_status(conn, tmdb_id, "failed", str(e)[:500])
        return "failed"


def run() -> None:
    dsn = os.getenv("AI_DATABASE_URL")
    if not dsn:
        raise SystemExit("AI_DATABASE_URL 환경변수가 필요합니다 (vm5).")

    counts = {"done": 0, "skipped": 0, "failed": 0, "cached": 0}
    requests_made = 0

    with psycopg.connect(dsn, autocommit=True) as conn, \
            httpx.Client(timeout=60, verify=False) as http:
        for tmdb_id in db.iter_movies():
            if db.get_state(conn, tmdb_id) == "done":
                counts["cached"] += 1
                continue
            if requests_made >= MAX_REQUESTS_PER_RUN:
                print(f"1회 상한({MAX_REQUESTS_PER_RUN}) 도달 — 종료")
                break
            try:
                result = process_movie(conn, http, tmdb_id)
            except subdl.SubdlRateLimit:
                print("subdl rate limit — 종료(나머지 pending)")
                break
            requests_made += 1
            counts[result] = counts.get(result, 0) + 1
            time.sleep(REQUEST_DELAY)

    print(f"완료: {counts} (요청 {requests_made}회)")


if __name__ == "__main__":
    run()
