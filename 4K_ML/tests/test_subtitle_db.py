import os

import httpx
import pytest

from subtitle_fetch import db


def test_iter_movies_paginates(monkeypatch):
    monkeypatch.setenv("DATA_SUPABASE_URL", "https://vm4")
    monkeypatch.setenv("DATA_SUPABASE_KEY", "k")
    pages = [[{"tmdb_id": 1}, {"tmdb_id": 2}], []]
    calls = {"n": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        i = calls["n"]
        calls["n"] += 1
        return httpx.Response(200, json=pages[min(i, len(pages) - 1)])

    real_client = httpx.Client  # 패치 전 원본 캡처 (재귀 방지)
    monkeypatch.setattr(
        db.httpx, "Client",
        lambda **kw: real_client(transport=httpx.MockTransport(handler)),
    )
    assert list(db.iter_movies(page_size=2)) == [1, 2]


# --- 아래는 로컬 Postgres(TEST_DATABASE_URL)가 있을 때만 실행 ---
DSN = os.getenv("TEST_DATABASE_URL")
pg = pytest.mark.skipif(not DSN, reason="TEST_DATABASE_URL 미설정")


@pg
def test_save_and_status_roundtrip():
    import pathlib

    import psycopg

    from db.apply_schema import apply_schema

    with psycopg.connect(DSN, autocommit=True) as conn:
        conn.execute("drop schema if exists training cascade;")
    apply_schema(DSN, str(pathlib.Path(__file__).resolve().parents[1] / "db" / "schema.sql"))

    with psycopg.connect(DSN, autocommit=True) as conn:
        assert db.get_state(conn, 999) is None
        db.set_status(conn, 999, "pending")
        chosen = {"url": "/x.zip", "release_name": "R", "hi": 1}
        db.save_subtitle(conn, 999, chosen, "srt-text")
        db.set_status(conn, 999, "done")
        assert db.get_state(conn, 999) == "done"
        row = conn.execute(
            "select is_sdh, raw_text from training.subtitles where tmdb_id=999"
        ).fetchone()
        assert row[0] is True and row[1] == "srt-text"
