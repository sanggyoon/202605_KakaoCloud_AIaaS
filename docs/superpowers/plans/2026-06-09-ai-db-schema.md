# vm5 AI DB 스키마 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** vm5 AI DB(Supabase/Postgres)에 ML 파이프라인용 `training` 스키마 6개 테이블을 멱등 DDL로 정의하고, 적용 스크립트와 검증 테스트를 만든다.

**Architecture:** DDL은 단일 `4K_ML/db/schema.sql`(멱등, `if not exists`)에 두고, 얇은 `apply_schema()` 함수가 Postgres 연결에 통째로 실행한다. 같은 함수를 pytest(로컬 Postgres 대상)와 운영 적용(CLI, `AI_DATABASE_URL`)이 공유한다.

**Tech Stack:** Postgres(Supabase), Python 3.11, psycopg 3, pytest. 테스트는 로컬 Postgres(Docker) 필요.

**Spec:** `docs/superpowers/specs/2026-06-09-ai-db-schema-design.md`

**작업 디렉터리:** 모든 Python/pytest 명령은 `4K_ML/`에서 실행. 커밋은 리포 루트(`/Users/sanggyoon/Documents/KakaoCloud_Project`).

---

## File Structure

- Create: `4K_ML/db/__init__.py` — `db` 패키지 마커
- Create: `4K_ML/db/schema.sql` — `training` 스키마 DDL (6개 테이블)
- Create: `4K_ML/db/apply_schema.py` — `apply_schema(dsn, sql_path)` + CLI(`AI_DATABASE_URL`)
- Create: `4K_ML/tests/__init__.py`
- Create: `4K_ML/tests/test_schema.py` — 로컬 Postgres 대상 검증(테이블 생성·멱등·FK)
- Create: `4K_ML/pytest.ini` — `pythonpath = .`
- Modify: `4K_ML/requirements.txt` — `psycopg[binary]`, `pytest` 추가

---

## Task 1: 의존성 + 스캐폴딩

**Files:**
- Modify: `4K_ML/requirements.txt`
- Create: `4K_ML/pytest.ini`, `4K_ML/db/__init__.py`, `4K_ML/tests/__init__.py`

- [ ] **Step 1: requirements에 의존성 추가**

`4K_ML/requirements.txt` 맨 끝에 두 줄 추가:

```
psycopg[binary]==3.2.3
pytest==8.3.4
```

- [ ] **Step 2: 설치**

Run: `cd 4K_ML && .venv/bin/pip install -r requirements.txt`
Expected: psycopg, pytest 설치 완료 (이미 있으면 "already satisfied")

- [ ] **Step 3: pytest 설정 + 패키지 마커 생성**

`4K_ML/pytest.ini`:

```ini
[pytest]
pythonpath = .
```

`4K_ML/db/__init__.py` — 빈 파일.

`4K_ML/tests/__init__.py` — 빈 파일.

(빈 파일 생성 명령 예: `cd 4K_ML && mkdir -p db tests && touch db/__init__.py tests/__init__.py`)

- [ ] **Step 4: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_ML/requirements.txt 4K_ML/pytest.ini 4K_ML/db/__init__.py 4K_ML/tests/__init__.py
git commit -m "chore(ml): db 스키마 작업용 의존성(psycopg/pytest)·스캐폴딩"
```

---

## Task 2: 스키마 DDL + 적용 함수 + 검증 (TDD)

**Files:**
- Test: `4K_ML/tests/test_schema.py`
- Create: `4K_ML/db/schema.sql`
- Create: `4K_ML/db/apply_schema.py`

**선행: 로컬 Postgres 기동** (테스트용)

Run:
```bash
docker run --rm -d --name 4k-pg-test -e POSTGRES_PASSWORD=test -p 5433:5432 postgres:16
export TEST_DATABASE_URL="postgresql://postgres:test@localhost:5433/postgres"
```
Expected: 컨테이너 기동. (Docker 불가 환경이면 테스트는 자동 skip — 이 경우 Step 5의 vm5 수동 적용으로 검증)

- [ ] **Step 1: 실패하는 테스트 작성**

`4K_ML/tests/test_schema.py`:

```python
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd 4K_ML && .venv/bin/python -m pytest tests/test_schema.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'db.apply_schema'` (아직 미작성)

- [ ] **Step 3: 적용 함수 작성**

`4K_ML/db/apply_schema.py`:

```python
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
```

- [ ] **Step 4: DDL 작성**

`4K_ML/db/schema.sql`:

```sql
create schema if not exists training;

-- 1. 자막 원본 (영화당 1개)
create table if not exists training.subtitles (
  id               bigint generated always as identity primary key,
  tmdb_id          bigint not null unique,
  language         text   not null default 'en',
  provider         text,
  provider_file_id text,
  release_name     text,
  raw_text         text   not null,
  created_at       timestamptz not null default now()
);

-- 3. 씬 (dialogues가 참조하므로 먼저 생성)
create table if not exists training.scenes (
  id             bigint generated always as identity primary key,
  subtitles_id   bigint not null references training.subtitles(id) on delete cascade,
  scene_index    int    not null,
  start_ms       int    not null,
  end_ms         int    not null,
  progress_ratio double precision not null,
  text           text   not null,
  dialogue_count int    not null default 0,
  split_method   text,
  created_at     timestamptz not null default now(),
  unique (subtitles_id, scene_index)
);
create index if not exists scenes_subtitles_id_idx on training.scenes (subtitles_id);

-- 2. 대사 (자막 한 줄)
create table if not exists training.dialogues (
  id             bigint generated always as identity primary key,
  subtitles_id   bigint not null references training.subtitles(id) on delete cascade,
  scenes_id      bigint references training.scenes(id) on delete set null,
  line_index     int    not null,
  start_ms       int    not null,
  end_ms         int    not null,
  duration_ms    int    not null,
  text           text   not null,
  char_count     int    not null,
  word_count     int    not null,
  gap_before_ms  int,
  progress_ratio double precision not null,
  unique (subtitles_id, line_index)
);
create index if not exists dialogues_subtitles_id_idx on training.dialogues (subtitles_id);
create index if not exists dialogues_scenes_id_idx on training.dialogues (scenes_id);

-- 6. 모델 버전 레지스트리 (scene_scores가 참조하므로 먼저 생성)
create table if not exists training.model_versions (
  model_version text primary key,
  kind          text not null,
  description   text,
  metrics       jsonb,
  created_at    timestamptz not null default now()
);

-- 4. 씬 점수
create table if not exists training.scene_scores (
  id            bigint generated always as identity primary key,
  scenes_id     bigint not null references training.scenes(id) on delete cascade,
  score         double precision not null,
  model_version text not null references training.model_versions(model_version),
  created_at    timestamptz not null default now(),
  unique (scenes_id, model_version)
);
create index if not exists scene_scores_model_version_idx on training.scene_scores (model_version);

-- 5. 영화별 파이프라인 진행 상태
create table if not exists training.processing_status (
  tmdb_id        bigint primary key,
  subtitle_state text not null default 'pending',
  parse_state    text not null default 'pending',
  label_state    text not null default 'pending',
  score_state    text not null default 'pending',
  vector_state   text not null default 'pending',
  error          text,
  retry_count    int  not null default 0,
  updated_at     timestamptz not null default now()
);
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd 4K_ML && .venv/bin/python -m pytest tests/test_schema.py -v`
Expected: PASS (3 passed) — Postgres 미가용 시 `3 skipped`

- [ ] **Step 6: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_ML/db/schema.sql 4K_ML/db/apply_schema.py 4K_ML/tests/test_schema.py
git commit -m "feat(ml): vm5 training 스키마 DDL + 적용 함수 + 검증 테스트"
```

- [ ] **Step 7: 로컬 Postgres 정리**

Run: `docker stop 4k-pg-test`
Expected: 컨테이너 종료(`--rm`으로 자동 삭제)

---

## Task 3: vm5 적용 안내 (운영 핸드오프)

**Files:** (없음 — 문서/실행만)

- [ ] **Step 1: vm5 연결 문자열 확보**

vm5 Supabase의 Postgres 연결 문자열을 `AI_DATABASE_URL`로 준비.
형식: `postgresql://<user>:<pass>@<host>:5432/postgres`
(Supabase 대시보드 → Project Settings → Database → Connection string. 직접 연결이 막혀 있으면 6543 풀러 포트 사용.)

- [ ] **Step 2: 스키마 적용**

Run:
```bash
cd 4K_ML
export AI_DATABASE_URL="postgresql://...:...@...:5432/postgres"
.venv/bin/python -m db.apply_schema
```
Expected: `✅ training 스키마 적용 완료`

- [ ] **Step 3: 적용 확인**

Supabase SQL Editor 또는 psql에서:
```sql
select table_name from information_schema.tables where table_schema='training';
```
Expected: subtitles, scenes, dialogues, model_versions, scene_scores, processing_status 6개 확인.

(대안: Supabase SQL Editor에 `4K_ML/db/schema.sql` 내용을 붙여넣어 직접 실행해도 동일.)

---

## Self-Review 메모

- **Spec 커버리지:** 6개 테이블·인덱스·FK·멱등 DDL(Task 2 Step 4), `training` 스키마(schema.sql 첫 줄), 적용 방식 결정(`db/schema.sql` + `apply_schema.py`, 미해결 항목 해소), 검증(Task 2 테스트: 테이블 생성·멱등·FK 거부) 모두 매핑됨.
- **타입/이름 일관성:** `apply_schema(dsn, sql_path)` 시그니처가 테스트·CLI·plan 본문에서 동일. FK 컬럼명 `subtitles_id`/`scenes_id`가 spec과 일치. 테이블 6개 이름이 테스트 집합과 DDL에서 일치.
- **Placeholder:** 없음.
- **주의:** 테스트는 로컬 Postgres가 있어야 실제 검증됨(없으면 skip). 최종 신뢰 검증은 Task 3의 vm5 적용 + 테이블 확인.
