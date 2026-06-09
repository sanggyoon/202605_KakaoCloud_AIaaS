# 자막 수집 (subdl → vm5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** subdl에서 영화별 영어 자막 1개를 규칙 선택·다운로드해 vm5 `training.subtitles`에 적재하는 CLI 배치를 만든다. vm4 `movies`를 순회하며 vm5 `processing_status`를 멱등 원장으로 사용.

**Architecture:** `4K_ML/subtitle_fetch/`에 책임별 모듈(subdl 클라이언트 / 순수 선택 로직 / DB 입출력 / 배치 메인) 분리. 순수 로직과 파싱은 TDD 유닛 테스트, 네트워크·오케스트레이션은 모킹 테스트, 실제 SQL은 vm5 런타임에서 검증.

**Tech Stack:** Python 3.11, httpx(검색·다운로드), psycopg 3(vm5 쓰기), zipfile, pytest. (의존성은 하위 프로젝트 A에서 이미 설치됨: httpx·psycopg·pytest.)

**Spec:** `docs/superpowers/specs/2026-06-09-subtitle-fetch-design.md`

**작업 디렉터리:** Python/pytest는 `4K_ML/`에서 실행. 커밋은 리포 루트(`/Users/sanggyoon/Documents/KakaoCloud_Project`).

---

## File Structure

- Create: `4K_ML/subtitle_fetch/__init__.py`
- Create: `4K_ML/subtitle_fetch/select.py` — 순수 선택 로직(필터·SDH우선·반환순)
- Create: `4K_ML/subtitle_fetch/subdl_client.py` — subdl 검색·다운로드·srt 추출·rate-limit
- Create: `4K_ML/subtitle_fetch/db.py` — vm4 movies 읽기(REST) + vm5 subtitles/status 쓰기(psycopg)
- Create: `4K_ML/subtitle_fetch/fetch_subtitles.py` — 배치 메인(흐름·페이싱·상한·우아한 중단)
- Modify: `4K_ML/db/schema.sql` — `subtitles.is_sdh` 컬럼 추가
- Test: `4K_ML/tests/test_select.py`, `test_subdl_client.py`, `test_subtitle_db.py`, `test_fetch_subtitles.py`

---

## Task 1: 패키지 스캐폴딩

**Files:**
- Create: `4K_ML/subtitle_fetch/__init__.py`

- [ ] **Step 1: 패키지 생성**

Run: `cd 4K_ML && mkdir -p subtitle_fetch && touch subtitle_fetch/__init__.py`

- [ ] **Step 2: import 가능 확인**

Run: `cd 4K_ML && .venv/bin/python -c "import subtitle_fetch; print('ok')"`
Expected: `ok`

- [ ] **Step 3: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_ML/subtitle_fetch/__init__.py
git commit -m "chore(ml): subtitle_fetch 패키지 스캐폴딩"
```

---

## Task 2: 스키마에 `is_sdh` 추가

**Files:**
- Modify: `4K_ML/db/schema.sql`

- [ ] **Step 1: schema.sql의 subtitles에 컬럼 추가**

`4K_ML/db/schema.sql`에서 `training.subtitles` 정의의 `raw_text` 줄 다음에 한 줄 추가:

```sql
  raw_text         text   not null,
  is_sdh           boolean,
  created_at       timestamptz not null default now()
```

(즉 `raw_text`와 `created_at` 사이에 `is_sdh boolean,`을 끼워 넣는다.)

- [ ] **Step 2: vm5에 컬럼 적용**

vm5 Supabase SQL Editor에서 실행(멱등):

```sql
alter table training.subtitles add column if not exists is_sdh boolean;
```

Expected: 성공(이미 있으면 무변경). 확인:
```sql
select column_name from information_schema.columns
where table_schema='training' and table_name='subtitles' and column_name='is_sdh';
```
→ `is_sdh` 1행.

- [ ] **Step 3: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_ML/db/schema.sql
git commit -m "feat(ml): subtitles.is_sdh 컬럼 추가(SDH 선택 기록)"
```

---

## Task 3: 선택 로직 `select.py` (TDD)

**Files:**
- Test: `4K_ML/tests/test_select.py`
- Create: `4K_ML/subtitle_fetch/select.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`4K_ML/tests/test_select.py`:

```python
from subtitle_fetch import select as sel


def test_choose_prefers_sdh():
    c = [{"name": "a.srt", "hi": 0}, {"name": "b.srt", "hi": 1}]
    assert sel.choose(c)["name"] == "b.srt"


def test_choose_filters_non_srt():
    assert sel.choose([{"name": "a.sub", "hi": 1}]) is None


def test_choose_fallback_to_non_sdh():
    c = [{"name": "a.srt", "hi": 0}]
    assert sel.choose(c)["name"] == "a.srt"


def test_choose_skips_full_season():
    assert sel.choose([{"name": "a.srt", "hi": 1, "full_season": True}]) is None


def test_choose_tiebreak_keeps_return_order():
    c = [{"name": "first.srt", "hi": 1}, {"name": "second.srt", "hi": 1}]
    assert sel.choose(c)["name"] == "first.srt"


def test_choose_empty_returns_none():
    assert sel.choose([]) is None
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd 4K_ML && .venv/bin/python -m pytest tests/test_select.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'subtitle_fetch.select'`

- [ ] **Step 3: 구현**

`4K_ML/subtitle_fetch/select.py`:

```python
"""subdl 후보 중 영화당 1개를 고르는 순수 선택 로직 (네트워크 없음)."""


def is_srt(c: dict) -> bool:
    fmt = (c.get("format") or "").lower()
    if fmt:
        return fmt == "srt"
    return (c.get("name") or "").lower().endswith(".srt")


def is_sdh(c: dict) -> bool:
    return bool(c.get("hi"))


def _is_full_season(c: dict) -> bool:
    return bool(c.get("full_season"))


def _is_english(c: dict) -> bool:
    lang = (c.get("language") or c.get("lang") or "").lower()
    return lang in ("", "en", "english")


def choose(candidates: list[dict]) -> dict | None:
    """① EN·srt·단편 필터 → ② SDH 우선 → ③ subdl 반환순 1등. 없으면 None."""
    eligible = [
        c for c in candidates
        if _is_english(c) and is_srt(c) and not _is_full_season(c)
    ]
    if not eligible:
        return None
    sdh = [c for c in eligible if is_sdh(c)]
    return (sdh or eligible)[0]
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd 4K_ML && .venv/bin/python -m pytest tests/test_select.py -v`
Expected: PASS (6 passed)

- [ ] **Step 5: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_ML/subtitle_fetch/select.py 4K_ML/tests/test_select.py
git commit -m "feat(ml): 자막 선택 로직(select.choose) + 테스트"
```

---

## Task 4: subdl 클라이언트 `subdl_client.py` (TDD)

**Files:**
- Test: `4K_ML/tests/test_subdl_client.py`
- Create: `4K_ML/subtitle_fetch/subdl_client.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`4K_ML/tests/test_subdl_client.py`:

```python
import io
import zipfile

import httpx
import pytest

from subtitle_fetch import subdl_client as subdl


def test_largest_srt_picks_biggest():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("small.srt", "short")
        z.writestr("big.srt", "x" * 100)
        z.writestr("readme.txt", "ignore")
    assert subdl._largest_srt(buf.getvalue()) == "x" * 100


def test_largest_srt_no_srt_raises():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("a.txt", "x")
    with pytest.raises(ValueError):
        subdl._largest_srt(buf.getvalue())


def test_search_parses_subtitles(monkeypatch):
    monkeypatch.setenv("SUBDL_API_KEY", "k")

    def handler(req: httpx.Request) -> httpx.Response:
        assert "api.subdl.com" in str(req.url)
        assert req.url.params["tmdb_id"] == "123"
        return httpx.Response(200, json={"status": True, "subtitles": [{"name": "a.srt", "hi": 1}]})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    out = subdl.search(123, client)
    assert out[0]["name"] == "a.srt"


def test_search_raises_ratelimit_on_429(monkeypatch):
    monkeypatch.setenv("SUBDL_API_KEY", "k")

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    with pytest.raises(subdl.SubdlRateLimit):
        subdl.search(1, client)


def test_download_and_extract_returns_srt_text(monkeypatch):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("movie.srt", "1\n00:00:01,000 --> 00:00:02,000\nHi\n")
    zip_bytes = buf.getvalue()

    def handler(req: httpx.Request) -> httpx.Response:
        assert "dl.subdl.com" in str(req.url)
        return httpx.Response(200, content=zip_bytes)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    text = subdl.download_and_extract("/subtitle/1-2.zip", client)
    assert "Hi" in text
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd 4K_ML && .venv/bin/python -m pytest tests/test_subdl_client.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'subtitle_fetch.subdl_client'`

- [ ] **Step 3: 구현**

`4K_ML/subtitle_fetch/subdl_client.py`:

```python
"""subdl API 검색 + zip 다운로드/.srt 추출 + rate-limit 감지."""
import io
import os
import zipfile

import httpx

API_URL = "https://api.subdl.com/api/v1/subtitles"
DL_BASE = "https://dl.subdl.com"


class SubdlRateLimit(Exception):
    """subdl 일일 한도 초과/429."""


def _api_key() -> str:
    key = os.getenv("SUBDL_API_KEY", "")
    if not key:
        raise SystemExit("SUBDL_API_KEY 환경변수가 필요합니다.")
    return key


def search(tmdb_id: int, client: httpx.Client) -> list[dict]:
    """tmdb_id로 영어 영화 자막 후보 목록을 반환."""
    r = client.get(
        API_URL,
        params={
            "api_key": _api_key(),
            "tmdb_id": tmdb_id,
            "type": "movie",
            "languages": "EN",
            "subs_per_page": 30,
            "hi": 1,
            "releases": 1,
        },
    )
    if r.status_code == 429:
        raise SubdlRateLimit("subdl 429")
    r.raise_for_status()
    data = r.json()
    if isinstance(data, dict) and data.get("status") is False:
        msg = str(data.get("error", "")).lower()
        if "limit" in msg or "quota" in msg:
            raise SubdlRateLimit(msg)
        return []
    return data.get("subtitles", []) if isinstance(data, dict) else []


def download_and_extract(url_path: str, client: httpx.Client) -> str:
    """자막 zip을 받아 가장 큰 .srt 텍스트를 반환."""
    url = url_path if url_path.startswith("http") else f"{DL_BASE}{url_path}"
    r = client.get(url)
    if r.status_code == 429:
        raise SubdlRateLimit("subdl download 429")
    r.raise_for_status()
    return _largest_srt(r.content)


def _largest_srt(zip_bytes: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        srts = [n for n in z.namelist() if n.lower().endswith(".srt")]
        if not srts:
            raise ValueError("zip에 .srt 파일이 없음")
        biggest = max(srts, key=lambda n: z.getinfo(n).file_size)
        raw = z.read(biggest)
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("latin-1")
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd 4K_ML && .venv/bin/python -m pytest tests/test_subdl_client.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_ML/subtitle_fetch/subdl_client.py 4K_ML/tests/test_subdl_client.py
git commit -m "feat(ml): subdl 클라이언트(검색·다운로드·srt추출·ratelimit) + 테스트"
```

---

## Task 5: DB 입출력 `db.py`

**Files:**
- Test: `4K_ML/tests/test_subtitle_db.py`
- Create: `4K_ML/subtitle_fetch/db.py`

- [ ] **Step 1: 실패하는 테스트 작성 (iter_movies는 모킹, SQL 함수는 로컬 PG 있을 때만)**

`4K_ML/tests/test_subtitle_db.py`:

```python
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

    monkeypatch.setattr(
        db.httpx, "Client",
        lambda **kw: httpx.Client(transport=httpx.MockTransport(handler)),
    )
    assert list(db.iter_movies(page_size=2)) == [1, 2]


# --- 아래는 로컬 Postgres(TEST_DATABASE_URL)가 있을 때만 실행 ---
DSN = os.getenv("TEST_DATABASE_URL")
pg = pytest.mark.skipif(not DSN, reason="TEST_DATABASE_URL 미설정")


@pg
def test_save_and_status_roundtrip():
    import psycopg
    import pathlib
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd 4K_ML && .venv/bin/python -m pytest tests/test_subtitle_db.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'subtitle_fetch.db'`

- [ ] **Step 3: 구현**

`4K_ML/subtitle_fetch/db.py`:

```python
"""vm4 movies 읽기(REST) + vm5 subtitles/processing_status 쓰기(psycopg)."""
import os
from collections.abc import Iterator

import httpx


def _vm4() -> tuple[str, str]:
    url = os.getenv("DATA_SUPABASE_URL", "https://data.peakly.art")
    key = os.getenv("DATA_SUPABASE_KEY", "")
    return url, key


def iter_movies(page_size: int = 1000) -> Iterator[int]:
    """vm4 service DB의 movies에서 tmdb_id를 페이지네이션으로 순회."""
    url, key = _vm4()
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    offset = 0
    with httpx.Client(timeout=30, verify=False) as client:
        while True:
            r = client.get(
                f"{url}/rest/v1/movies",
                params={"select": "tmdb_id", "limit": page_size,
                        "offset": offset, "order": "tmdb_id"},
                headers=headers,
            )
            r.raise_for_status()
            rows = r.json()
            for row in rows:
                yield row["tmdb_id"]
            if len(rows) < page_size:
                break
            offset += page_size


def get_state(conn, tmdb_id: int) -> str | None:
    row = conn.execute(
        "select subtitle_state from training.processing_status where tmdb_id=%s",
        (tmdb_id,),
    ).fetchone()
    return row[0] if row else None


def save_subtitle(conn, tmdb_id: int, chosen: dict, raw_text: str) -> None:
    conn.execute(
        """
        insert into training.subtitles
          (tmdb_id, language, provider, provider_file_id, release_name, is_sdh, raw_text)
        values (%s, 'en', 'subdl', %s, %s, %s, %s)
        on conflict (tmdb_id) do update set
          provider_file_id = excluded.provider_file_id,
          release_name     = excluded.release_name,
          is_sdh           = excluded.is_sdh,
          raw_text         = excluded.raw_text
        """,
        (tmdb_id, str(chosen.get("url") or ""), chosen.get("release_name"),
         bool(chosen.get("hi")), raw_text),
    )


def set_status(conn, tmdb_id: int, state: str, error: str | None = None) -> None:
    conn.execute(
        """
        insert into training.processing_status (tmdb_id, subtitle_state, error, updated_at)
        values (%s, %s, %s, now())
        on conflict (tmdb_id) do update set
          subtitle_state = excluded.subtitle_state,
          error          = excluded.error,
          retry_count    = training.processing_status.retry_count
                           + case when excluded.subtitle_state = 'failed' then 1 else 0 end,
          updated_at     = now()
        """,
        (tmdb_id, state, error),
    )
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd 4K_ML && .venv/bin/python -m pytest tests/test_subtitle_db.py -v`
Expected: `test_iter_movies_paginates` PASS, DB 테스트는 PASS 또는 SKIP(로컬 PG 없으면)

- [ ] **Step 5: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_ML/subtitle_fetch/db.py 4K_ML/tests/test_subtitle_db.py
git commit -m "feat(ml): db 입출력(vm4 movies 순회 + vm5 subtitles/status) + 테스트"
```

---

## Task 6: 배치 메인 `fetch_subtitles.py` (TDD)

**Files:**
- Test: `4K_ML/tests/test_fetch_subtitles.py`
- Create: `4K_ML/subtitle_fetch/fetch_subtitles.py`

- [ ] **Step 1: 실패하는 테스트 작성 (process_movie 상태 전이)**

`4K_ML/tests/test_fetch_subtitles.py`:

```python
import pytest

from subtitle_fetch import fetch_subtitles as main


def _patch_common(monkeypatch, statuses, saved):
    monkeypatch.setattr(main.db, "get_state", lambda conn, t: None)
    monkeypatch.setattr(main.db, "set_status",
                        lambda conn, t, s, error=None: statuses.append((s, error)))
    monkeypatch.setattr(main.db, "save_subtitle",
                        lambda conn, t, c, r: saved.append((t, bool(c.get("hi")), r)))


def test_process_movie_done(monkeypatch):
    statuses, saved = [], []
    _patch_common(monkeypatch, statuses, saved)
    monkeypatch.setattr(main.subdl, "search",
                        lambda t, http: [{"name": "a.srt", "hi": 1, "url": "/x.zip", "release_name": "R"}])
    monkeypatch.setattr(main.subdl, "download_and_extract",
                        lambda url, http: "1\n00:00:01,000 --> 00:00:02,000\nHi\n")
    assert main.process_movie(None, None, 123) == "done"
    assert saved == [(123, True, "1\n00:00:01,000 --> 00:00:02,000\nHi\n")]
    assert statuses == [("done", None)]


def test_process_movie_skipped_when_no_candidate(monkeypatch):
    statuses, saved = [], []
    _patch_common(monkeypatch, statuses, saved)
    monkeypatch.setattr(main.subdl, "search", lambda t, http: [{"name": "a.sub", "hi": 0}])
    assert main.process_movie(None, None, 1) == "skipped"
    assert statuses == [("skipped", None)]


def test_process_movie_failed_on_error(monkeypatch):
    statuses, saved = [], []
    _patch_common(monkeypatch, statuses, saved)

    def boom(t, http):
        raise RuntimeError("net down")

    monkeypatch.setattr(main.subdl, "search", boom)
    assert main.process_movie(None, None, 1) == "failed"
    assert statuses[0][0] == "failed" and "net down" in statuses[0][1]


def test_process_movie_ratelimit_propagates(monkeypatch):
    statuses, saved = [], []
    _patch_common(monkeypatch, statuses, saved)

    def rl(t, http):
        raise main.subdl.SubdlRateLimit("limit")

    monkeypatch.setattr(main.subdl, "search", rl)
    with pytest.raises(main.subdl.SubdlRateLimit):
        main.process_movie(None, None, 1)


def test_process_movie_cached(monkeypatch):
    monkeypatch.setattr(main.db, "get_state", lambda conn, t: "done")
    assert main.process_movie(None, None, 1) == "cached"
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd 4K_ML && .venv/bin/python -m pytest tests/test_fetch_subtitles.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'subtitle_fetch.fetch_subtitles'`

- [ ] **Step 3: 구현**

`4K_ML/subtitle_fetch/fetch_subtitles.py`:

```python
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd 4K_ML && .venv/bin/python -m pytest tests/test_fetch_subtitles.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: 전체 테스트 회귀 확인**

Run: `cd 4K_ML && .venv/bin/python -m pytest -q`
Expected: 전부 PASS (DB 테스트는 로컬 PG 없으면 일부 SKIP)

- [ ] **Step 6: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_ML/subtitle_fetch/fetch_subtitles.py 4K_ML/tests/test_fetch_subtitles.py
git commit -m "feat(ml): 자막 수집 배치 메인(fetch_subtitles) + 테스트"
```

---

## Task 7: 실제 실행 검증 (운영 핸드오프)

**Files:** (없음 — 실행/검증만)

- [ ] **Step 1: env 준비**

`4K_ML/.env`에 추가(없는 것만):
```
SUBDL_API_KEY=<무료 키>
AI_DATABASE_URL=postgresql://...:...@<vm5>:5432/postgres
DATA_SUPABASE_URL=https://data.peakly.art
DATA_SUPABASE_KEY=<vm4 service_role key>
```
(`fetch_subtitles.py`는 `os.getenv`만 사용하므로, 로컬 실행 시 `python-dotenv`로 .env를 불러오려면 `set -a; source .env; set +a`로 export 후 실행.)

- [ ] **Step 2: 소규모 시범 실행**

먼저 1회 상한을 낮춰 몇 편만:
```bash
cd 4K_ML
set -a; source .env; set +a
SUBDL_MAX_PER_RUN=5 .venv/bin/python -m subtitle_fetch.fetch_subtitles
```
Expected: `완료: {'done': N, 'skipped': M, ...}` 출력, 오류 없음.

- [ ] **Step 3: vm5 적재 확인**

vm5 SQL Editor:
```sql
select count(*) from training.subtitles;
select subtitle_state, count(*) from training.processing_status group by subtitle_state;
select tmdb_id, is_sdh, length(raw_text) from training.subtitles limit 5;
```
Expected: subtitles에 행 생성, status가 done/skipped/failed로 분포, raw_text 길이가 0보다 큼.

- [ ] **Step 4: 멱등성 확인**

같은 명령 재실행 → 이미 done인 영화는 `cached`로 잡혀 subdl 재호출이 없어야 함(출력의 cached 증가, done은 신규만).

- [ ] **Step 5: (선택) 전체 실행**

상한 기본값(1800)으로 실행. 하루 한도 도달 시 자동 종료 → 다음날 재실행으로 이어서 처리.

---

## Self-Review 메모

- **Spec 커버리지:** 선택 규칙(Task 3) / subdl 검색·다운로드·srt추출·ratelimit(Task 4) / vm4 순회·vm5 멱등 원장(Task 5·6) / 상태 의미 skipped·failed·ratelimit중단(Task 6 process_movie·run) / is_sdh 스키마(Task 2) / 페이싱·상한(Task 6) / 실측 검증(Task 7) 모두 매핑됨.
- **타입/이름 일관성:** `choose`/`is_srt`/`is_sdh`(select), `search`/`download_and_extract`/`_largest_srt`/`SubdlRateLimit`(subdl_client), `iter_movies`/`get_state`/`save_subtitle`/`set_status`(db), `process_movie`/`run`(main) — 테스트·구현·본문에서 시그니처 동일. `chosen` dict 키(`url`/`release_name`/`hi`)가 save_subtitle와 일치.
- **Placeholder:** 없음. subdl 응답 필드명은 Task 7 실측에서 확인(spec의 명시된 후속).
- **주의:** db.py의 실제 SQL은 로컬 PG 없으면 SKIP → 최종 신뢰 검증은 Task 7의 vm5 실행.
