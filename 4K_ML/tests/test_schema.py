import os
import pathlib

import psycopg
import pytest

from db.apply_schema import apply_schema

SCHEMA = pathlib.Path(__file__).resolve().parents[1] / "db" / "schema.sql"
DSN = os.getenv("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DSN, reason="TEST_DATABASE_URL 미설정 — 로컬 Postgres 필요"
)


@pytest.fixture
def clean_db():
    # training 스키마를 깨끗이 비우고 시작
    with psycopg.connect(DSN, autocommit=True) as conn:
        conn.execute("drop schema if exists training cascade;")
    yield


def test_apply_creates_all_tables(clean_db):
    apply_schema(DSN, str(SCHEMA))
    with psycopg.connect(DSN, autocommit=True) as conn:
        rows = conn.execute(
            "select table_name from information_schema.tables "
            "where table_schema='training'"
        ).fetchall()
    names = {r[0] for r in rows}
    assert names == {
        "subtitles", "scenes", "dialogues",
        "model_versions", "scene_scores", "processing_status",
    }


def test_apply_is_idempotent(clean_db):
    apply_schema(DSN, str(SCHEMA))
    apply_schema(DSN, str(SCHEMA))  # 두 번째 실행도 에러 없어야 함


def test_scene_scores_requires_known_model_version(clean_db):
    apply_schema(DSN, str(SCHEMA))
    with psycopg.connect(DSN, autocommit=True) as conn:
        conn.execute("insert into training.subtitles (tmdb_id, raw_text) values (1, 'x')")
        sid = conn.execute(
            "select id from training.subtitles where tmdb_id=1"
        ).fetchone()[0]
        conn.execute(
            "insert into training.scenes "
            "(subtitles_id, scene_index, start_ms, end_ms, progress_ratio, text) "
            "values (%s, 0, 0, 1000, 0.5, 'hi')",
            (sid,),
        )
        scene_id = conn.execute("select id from training.scenes limit 1").fetchone()[0]
        # 등록되지 않은 model_version → FK 위반이어야 함
        with pytest.raises(psycopg.errors.ForeignKeyViolation):
            conn.execute(
                "insert into training.scene_scores (scenes_id, score, model_version) "
                "values (%s, 0.9, 'ghost')",
                (scene_id,),
            )
