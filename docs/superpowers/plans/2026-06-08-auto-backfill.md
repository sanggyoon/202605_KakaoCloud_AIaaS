# 자동 영화 Backfill + 최근 추가 데이터 보기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TMDB 인기작 중 서비스 DB에 없는 영화를 주기적으로 자동 채우고(K8s CronJob, 실행당 신규 100개 한도), 매니저 페이지에서 최근 추가된 영화를 확인할 수 있게 한다.

**Architecture:** `4K_BE/app/tmdb_common.py`에 TMDB↔Supabase 공통 함수를 모으고, `app/backfill_popular.py`가 인기순 페이지를 순회하며 누락분만 upsert한다. CronJob이 BE 이미지로 `python -m app.backfill_popular`를 매일 실행한다. 최근 추가 목록은 `main.py`의 `/api/movies/recent`(created_at 내림차순) → FE 프록시 → `/movie_list/recent` 페이지로 노출한다.

**Tech Stack:** Python 3.11, FastAPI, httpx(`MockTransport`로 테스트), pytest, Next.js 16/TypeScript, Kustomize/ArgoCD.

---

## File Structure

| 종류 | 경로 | 책임 |
|---|---|---|
| 신규 | `4K_BE/requirements-dev.txt` | pytest 등 개발 의존성 |
| 신규 | `4K_BE/app/__init__.py` | `app`을 패키지로(없으면 생성) |
| 신규 | `4K_BE/app/tmdb_common.py` | TMDB 조회·movie dict 빌드·Supabase 조회/upsert 공통 함수 |
| 신규 | `4K_BE/app/backfill_popular.py` | 인기순 backfill 루프 + 진입점 |
| 수정 | `4K_BE/app/main.py` | tmdb_common 재사용 + `/api/movies/recent` 추가 |
| 신규 | `4K_BE/tests/__init__.py` | 테스트 패키지 |
| 신규 | `4K_BE/tests/test_tmdb_common.py` | 공통 함수 단위 테스트 |
| 신규 | `4K_BE/tests/test_backfill.py` | backfill 루프 테스트(멱등성/한도) |
| 신규 | `4K_BE/tests/test_main_recent.py` | recent 엔드포인트 테스트 |
| 신규 | `Ansible/manifests/4k-be/backfill-cronjob.yaml` | 매일 실행 CronJob |
| 수정 | `Ansible/manifests/4k-be/kustomization.yaml` | CronJob resources 등록 |
| 신규 | `4K_FE/app/api/manager/movies/recent/route.ts` | recent FE 프록시 |
| 신규 | `4K_FE/app/movie_list/recent/page.tsx` | "최근 추가 데이터" 화면 |

모든 BE 테스트는 가상환경에서 실행:
`cd 4K_BE && source .venv/bin/activate && pip install -r requirements-dev.txt` (Task 1에서 1회).
이후 테스트 명령은 `cd 4K_BE && python -m pytest <경로> -v`.

---

## Task 1: 테스트 환경 + tmdb_common 순수 함수 (pick_trailer, build_movie)

**Files:**
- Create: `4K_BE/requirements-dev.txt`
- Create: `4K_BE/app/__init__.py` (빈 파일, 이미 있으면 생략)
- Create: `4K_BE/app/tmdb_common.py`
- Create: `4K_BE/tests/__init__.py` (빈 파일)
- Test: `4K_BE/tests/test_tmdb_common.py`

- [ ] **Step 1: 개발 의존성 파일 작성**

`4K_BE/requirements-dev.txt`:
```
-r requirements.txt
pytest==8.3.4
pytest-asyncio==0.25.2
```

- [ ] **Step 2: 의존성 설치**

Run: `cd 4K_BE && source .venv/bin/activate && pip install -r requirements-dev.txt`
Expected: pytest, pytest-asyncio 설치 완료.

- [ ] **Step 3: pytest asyncio 설정 추가**

`4K_BE/pytest.ini` 생성:
```ini
[pytest]
asyncio_mode = auto
```

- [ ] **Step 4: 실패하는 테스트 작성**

`4K_BE/tests/__init__.py` (빈 파일) 생성 후 `4K_BE/tests/test_tmdb_common.py`:
```python
from app import tmdb_common as tc


def test_pick_trailer_prefers_korean_youtube_trailer():
    videos = [
        {"site": "YouTube", "type": "Teaser", "iso_639_1": "en", "key": "teaser"},
        {"site": "YouTube", "type": "Trailer", "iso_639_1": "en", "key": "en_trailer"},
        {"site": "YouTube", "type": "Trailer", "iso_639_1": "ko", "key": "ko_trailer"},
    ]
    assert tc.pick_trailer(videos) == "ko_trailer"


def test_pick_trailer_returns_none_when_no_match():
    assert tc.pick_trailer([{"site": "Vimeo", "type": "Trailer", "key": "x"}]) is None


def test_build_movie_maps_fields():
    detail = {
        "imdb_id": "tt001",
        "title": "기생충",
        "original_title": "Parasite",
        "poster_path": "/p.jpg",
        "release_date": "2019-05-30",
        "runtime": 132,
        "genres": [{"name": "Drama"}, {"name": "Thriller"}],
        "overview": "줄거리",
        "credits": {
            "crew": [{"job": "Director", "name": "봉준호"}],
            "cast": [{"name": f"배우{i}"} for i in range(7)],
        },
        "videos": {"results": [{"site": "YouTube", "type": "Trailer", "iso_639_1": "ko", "key": "K"}]},
    }
    row = tc.build_movie(detail, 496243)
    assert row["tmdb_id"] == 496243
    assert row["title"] == "기생충"
    assert row["director"] == "봉준호"
    assert row["release_year"] == 2019
    assert row["genre"] == "Drama, Thriller"
    assert row["actors"] == "배우0, 배우1, 배우2, 배우3, 배우4"  # 상위 5명
    assert row["youtube_key"] == "K"


def test_build_movie_handles_missing_fields():
    row = tc.build_movie({"credits": {}, "videos": {}}, 1)
    assert row["tmdb_id"] == 1
    assert row["director"] is None
    assert row["release_year"] is None
    assert row["actors"] is None
    assert row["youtube_key"] is None
```

- [ ] **Step 5: 테스트 실패 확인**

Run: `cd 4K_BE && python -m pytest tests/test_tmdb_common.py -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'app.tmdb_common'` 또는 함수 없음).

- [ ] **Step 6: tmdb_common 순수 함수 구현**

`4K_BE/app/tmdb_common.py`:
```python
"""TMDB 조회 / movies dict 빌드 / Supabase 조회·upsert 공통 모듈.
main.py 와 backfill_popular.py 가 공유한다.
"""
import os

TMDB_KEY  = os.getenv("TMDB_API_KEY", "")
DATA_URL  = os.getenv("DATA_SUPABASE_URL", "https://data.peakly.art")
DATA_KEY  = os.getenv("DATA_SUPABASE_KEY", "")
TMDB_BASE = "https://api.themoviedb.org/3"


def sb_headers(resolution: str = "merge-duplicates") -> dict:
    """Supabase PostgREST 헤더. resolution: merge-duplicates | ignore-duplicates."""
    return {
        "apikey": DATA_KEY,
        "Authorization": f"Bearer {DATA_KEY}",
        "Content-Type": "application/json",
        "Prefer": f"resolution={resolution},return=minimal",
    }


def pick_trailer(videos: list[dict]) -> str | None:
    """YouTube 트레일러 키: 한국어 트레일러 → 영어 트레일러 → 티저 순."""
    priority = [
        lambda v: v["site"] == "YouTube" and v["type"] == "Trailer" and v.get("iso_639_1") == "ko",
        lambda v: v["site"] == "YouTube" and v["type"] == "Trailer",
        lambda v: v["site"] == "YouTube" and v["type"] == "Teaser",
    ]
    for pred in priority:
        match = next((v for v in videos if pred(v)), None)
        if match:
            return match["key"]
    return None


def build_movie(d: dict, tmdb_id: int) -> dict:
    """TMDB 상세 응답 → movies 테이블 row dict."""
    crew = d.get("credits", {}).get("crew", [])
    director = next((c["name"] for c in crew if c["job"] == "Director"), None)
    actors = ", ".join(c["name"] for c in d.get("credits", {}).get("cast", [])[:5])
    release_year = None
    if d.get("release_date"):
        try:
            release_year = int(d["release_date"][:4])
        except ValueError:
            pass
    return {
        "tmdb_id":        tmdb_id,
        "imdb_id":        d.get("imdb_id"),
        "title":          d.get("title"),
        "original_title": d.get("original_title"),
        "poster_path":    d.get("poster_path"),
        "director":       director,
        "release_year":   release_year,
        "runtime":        d.get("runtime") or None,
        "genre":          ", ".join(g["name"] for g in d.get("genres", [])),
        "actors":         actors or None,
        "overview":       d.get("overview") or None,
        "youtube_key":    pick_trailer(d.get("videos", {}).get("results", [])),
    }
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `cd 4K_BE && python -m pytest tests/test_tmdb_common.py -v`
Expected: 4 passed.

- [ ] **Step 8: 커밋**

```bash
cd 4K_BE
git add requirements-dev.txt pytest.ini app/__init__.py app/tmdb_common.py tests/__init__.py tests/test_tmdb_common.py
git commit -m "feat(be): tmdb_common 순수 함수(pick_trailer, build_movie) + 테스트 환경"
```

---

## Task 2: tmdb_common HTTP 함수 (discover, fetch_movie, get_existing_tmdb_ids, upsert_movies)

**Files:**
- Modify: `4K_BE/app/tmdb_common.py`
- Test: `4K_BE/tests/test_tmdb_common.py` (테스트 추가)

httpx의 `MockTransport`로 외부 호출 없이 검증한다(추가 의존성 없음).

- [ ] **Step 1: 실패하는 테스트 추가**

`4K_BE/tests/test_tmdb_common.py` 끝에 추가:
```python
import httpx
import pytest
from app import tmdb_common as tc


def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_tmdb_discover_returns_results():
    def handler(req: httpx.Request) -> httpx.Response:
        assert "/discover/movie" in str(req.url)
        assert req.url.params["sort_by"] == "popularity.desc"
        return httpx.Response(200, json={"results": [{"id": 1}, {"id": 2}]})
    async with _client(handler) as c:
        out = await tc.tmdb_discover(c, sort_by="popularity.desc", page=1)
    assert [m["id"] for m in out] == [1, 2]


async def test_fetch_movie_builds_row():
    def handler(req: httpx.Request) -> httpx.Response:
        assert "/movie/99" in str(req.url)
        return httpx.Response(200, json={"title": "T", "credits": {}, "videos": {}})
    async with _client(handler) as c:
        row = await tc.fetch_movie(c, 99)
    assert row["tmdb_id"] == 99 and row["title"] == "T"


async def test_fetch_movie_returns_none_on_error():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={})
    async with _client(handler) as c:
        assert await tc.fetch_movie(c, 99) is None


async def test_get_existing_tmdb_ids_parses_rows():
    def handler(req: httpx.Request) -> httpx.Response:
        assert "/rest/v1/movies" in str(req.url)
        return httpx.Response(200, json=[{"tmdb_id": 1}, {"tmdb_id": 5}])
    async with _client(handler) as c:
        ids = await tc.get_existing_tmdb_ids(c)
    assert ids == {1, 5}


async def test_upsert_movies_sends_ignore_duplicates():
    seen = {}
    def handler(req: httpx.Request) -> httpx.Response:
        seen["prefer"] = req.headers.get("Prefer", "")
        seen["conflict"] = req.url.params.get("on_conflict")
        return httpx.Response(201, json=[])
    async with _client(handler) as c:
        ok = await tc.upsert_movies(c, [{"tmdb_id": 1}], resolution="ignore-duplicates")
    assert ok is True
    assert "ignore-duplicates" in seen["prefer"]
    assert seen["conflict"] == "tmdb_id"
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd 4K_BE && python -m pytest tests/test_tmdb_common.py -k "discover or fetch_movie or existing or upsert" -v`
Expected: FAIL (함수 미정의).

- [ ] **Step 3: HTTP 함수 구현 (tmdb_common.py 에 추가)**

`4K_BE/app/tmdb_common.py` 끝에 추가:
```python
import httpx


async def tmdb_discover(client: httpx.AsyncClient, sort_by: str = "popularity.desc",
                        page: int = 1) -> list[dict]:
    """TMDB discover 한 페이지의 results 리스트 반환. 오류 시 빈 리스트."""
    r = await client.get(
        f"{TMDB_BASE}/discover/movie",
        params={
            "api_key": TMDB_KEY,
            "language": "ko-KR",
            "sort_by": sort_by,
            "include_adult": "false",
            "include_video": "false",
            "vote_count.gte": "10",
            "page": page,
        },
    )
    if r.status_code != 200:
        return []
    return r.json().get("results", [])


async def fetch_movie(client: httpx.AsyncClient, tmdb_id: int) -> dict | None:
    """TMDB 상세 → movies row dict. 오류(404 등) 시 None."""
    r = await client.get(
        f"{TMDB_BASE}/movie/{tmdb_id}",
        params={"api_key": TMDB_KEY, "language": "ko-KR",
                "append_to_response": "credits,videos"},
    )
    if r.status_code != 200:
        return None
    return build_movie(r.json(), tmdb_id)


async def get_existing_tmdb_ids(client: httpx.AsyncClient) -> set[int]:
    """movies 테이블의 모든 tmdb_id 집합. 조회 실패 시 빈 set."""
    r = await client.get(
        f"{DATA_URL}/rest/v1/movies",
        params={"select": "tmdb_id", "limit": "100000"},
        headers=sb_headers(),
    )
    if r.status_code != 200:
        return set()
    return {row["tmdb_id"] for row in r.json()}


async def upsert_movies(client: httpx.AsyncClient, rows: list[dict],
                        resolution: str = "ignore-duplicates") -> bool:
    """movies 배열 upsert. on_conflict=tmdb_id. 성공 여부 반환."""
    if not rows:
        return True
    r = await client.post(
        f"{DATA_URL}/rest/v1/movies",
        params={"on_conflict": "tmdb_id"},
        json=rows,
        headers=sb_headers(resolution),
    )
    return r.status_code in (200, 201, 204)
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd 4K_BE && python -m pytest tests/test_tmdb_common.py -v`
Expected: 모든 테스트 passed (Task1 4개 + Task2 5개 = 9 passed).

- [ ] **Step 5: 커밋**

```bash
cd 4K_BE
git add app/tmdb_common.py tests/test_tmdb_common.py
git commit -m "feat(be): tmdb_common HTTP 함수(discover/fetch/existing/upsert) + 테스트"
```

---

## Task 3: backfill_popular 루프 (멱등성 + 신규 한도)

**Files:**
- Create: `4K_BE/app/backfill_popular.py`
- Test: `4K_BE/tests/test_backfill.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`4K_BE/tests/test_backfill.py`:
```python
import httpx
from app import backfill_popular as bf


def _make_handler(existing_ids, discover_pages):
    """existing_ids: set, discover_pages: {page_int: [movie_dict,...]}"""
    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if "/rest/v1/movies" in url and req.method == "GET":
            return httpx.Response(200, json=[{"tmdb_id": i} for i in existing_ids])
        if "/discover/movie" in url:
            page = int(req.url.params.get("page", "1"))
            return httpx.Response(200, json={"results": discover_pages.get(page, [])})
        if "/movie/" in url and req.method == "GET":
            tid = int(url.split("/movie/")[1].split("?")[0])
            return httpx.Response(200, json={"title": f"M{tid}", "credits": {}, "videos": {}})
        if "/rest/v1/movies" in url and req.method == "POST":
            return httpx.Response(201, json=[])
        return httpx.Response(404, json={})
    return handler


async def _run(handler, max_new, max_pages=10):
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
        return await bf.run_backfill(c, max_new=max_new, max_pages=max_pages, rate_delay=0)


async def test_adds_only_missing_and_stops_at_max_new():
    handler = _make_handler(
        existing_ids={1, 2},
        discover_pages={1: [{"id": 1}, {"id": 2}, {"id": 3}, {"id": 4}]},
    )
    result = await _run(handler, max_new=1)
    # 1,2는 이미 존재 → 스킵. 3 추가 후 max_new=1 도달 → 중지(4는 안 함).
    assert result["added"] == 1


async def test_idempotent_when_all_exist():
    handler = _make_handler(
        existing_ids={1, 2, 3},
        discover_pages={1: [{"id": 1}, {"id": 2}, {"id": 3}]},
    )
    result = await _run(handler, max_new=100)
    assert result["added"] == 0


async def test_paginates_until_max_new():
    handler = _make_handler(
        existing_ids=set(),
        discover_pages={1: [{"id": 10}, {"id": 11}], 2: [{"id": 12}, {"id": 13}]},
    )
    result = await _run(handler, max_new=3)
    assert result["added"] == 3  # page1에서 2개 + page2에서 1개


async def test_stops_when_discover_empty():
    handler = _make_handler(existing_ids=set(), discover_pages={1: [{"id": 10}]})
    result = await _run(handler, max_new=100, max_pages=10)
    assert result["added"] == 1  # page2가 빈 결과 → 중지
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd 4K_BE && python -m pytest tests/test_backfill.py -v`
Expected: FAIL (`No module named 'app.backfill_popular'`).

- [ ] **Step 3: backfill_popular 구현**

`4K_BE/app/backfill_popular.py`:
```python
"""TMDB 인기작 중 DB에 없는 영화를 채우는 backfill.
실행: python -m app.backfill_popular  (CronJob 진입점)
"""
import asyncio
import os

import httpx

from app import tmdb_common as tc

MAX_NEW    = int(os.getenv("BACKFILL_MAX_NEW", "100"))
MAX_PAGES  = int(os.getenv("BACKFILL_MAX_PAGES", "100"))
RATE_DELAY = float(os.getenv("BACKFILL_RATE_DELAY", "0.26"))
BATCH_SIZE = 50


async def run_backfill(client: httpx.AsyncClient, max_new: int, max_pages: int,
                       rate_delay: float) -> dict:
    """인기순 페이지를 돌며 DB에 없는 영화를 upsert. 신규 max_new 도달 시 중지."""
    existing = await tc.get_existing_tmdb_ids(client)
    added, failed, batch, page = 0, [], [], 1

    while added < max_new and page <= max_pages:
        results = await tc.tmdb_discover(client, sort_by="popularity.desc", page=page)
        if not results:
            break
        for m in results:
            tid = m["id"]
            if tid in existing:
                continue
            movie = await tc.fetch_movie(client, tid)
            if movie:
                batch.append(movie)
                existing.add(tid)
                added += 1
                if len(batch) >= BATCH_SIZE:
                    await tc.upsert_movies(client, batch, resolution="ignore-duplicates")
                    batch.clear()
            else:
                failed.append(tid)
            if added >= max_new:
                break
            if rate_delay:
                await asyncio.sleep(rate_delay)
        page += 1

    if batch:
        await tc.upsert_movies(client, batch, resolution="ignore-duplicates")

    return {"added": added, "last_page": page, "failed": failed}


async def main() -> None:
    async with httpx.AsyncClient(timeout=20, verify=False) as client:
        result = await run_backfill(client, MAX_NEW, MAX_PAGES, RATE_DELAY)
    print(f"[backfill] 신규 {result['added']}개, 마지막 page {result['last_page']}, "
          f"실패 {len(result['failed'])}개: {result['failed']}")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd 4K_BE && python -m pytest tests/test_backfill.py -v`
Expected: 4 passed.

- [ ] **Step 5: 커밋**

```bash
cd 4K_BE
git add app/backfill_popular.py tests/test_backfill.py
git commit -m "feat(be): 인기작 backfill 루프(멱등성/신규 한도) + 테스트"
```

---

## Task 4: main.py — tmdb_common 재사용 + `/api/movies/recent`

**Files:**
- Modify: `4K_BE/app/main.py`
- Test: `4K_BE/tests/test_main_recent.py`

`recent` 핸들러는 `httpx.AsyncClient`를 내부 생성하므로, 테스트는 `monkeypatch`로 `httpx.AsyncClient`를 MockTransport 클라이언트로 치환한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`4K_BE/tests/test_main_recent.py`:
```python
import httpx
from fastapi.testclient import TestClient
from app import main


def _patch_client(monkeypatch, handler):
    def factory(*args, **kwargs):
        kwargs.pop("timeout", None); kwargs.pop("verify", None)
        return httpx.AsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(main.httpx, "AsyncClient", factory)


def test_recent_returns_movies(monkeypatch):
    def handler(req: httpx.Request) -> httpx.Response:
        assert "/rest/v1/movies" in str(req.url)
        assert req.url.params["order"] == "created_at.desc"
        assert req.url.params["limit"] == "50"
        return httpx.Response(200, json=[{"tmdb_id": 1, "title": "A", "has_vector": False}])
    _patch_client(monkeypatch, handler)
    client = TestClient(main.app)
    res = client.get("/api/movies/recent")
    assert res.status_code == 200
    assert res.json()["movies"][0]["tmdb_id"] == 1


def test_recent_clamps_limit(monkeypatch):
    captured = {}
    def handler(req: httpx.Request) -> httpx.Response:
        captured["limit"] = req.url.params["limit"]
        return httpx.Response(200, json=[])
    _patch_client(monkeypatch, handler)
    client = TestClient(main.app)
    client.get("/api/movies/recent?limit=9999")
    assert captured["limit"] == "200"  # 상한 200으로 클램프
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd 4K_BE && python -m pytest tests/test_main_recent.py -v`
Expected: FAIL (404 — `/api/movies/recent` 없음).

- [ ] **Step 3: main.py 수정 — import 추가**

`4K_BE/app/main.py` 상단 import 영역에 추가(기존 import 유지):
```python
from app import tmdb_common as tc
```

- [ ] **Step 4: main.py 수정 — recent 엔드포인트 추가**

`4K_BE/app/main.py`의 `movie_detail` 함수 정의 **앞**(라우트 등록 순서상 `/api/movies/{tmdb_id}/detail`보다 위)에 추가:
```python
@app.get("/api/movies/recent")
async def recent_movies(limit: int = 50):
    """최근 추가된 영화를 created_at 내림차순으로 반환 (매니저 '최근 추가 데이터' 화면용)."""
    limit = max(1, min(limit, 200))
    async with httpx.AsyncClient(timeout=15, verify=False) as client:
        r = await client.get(
            f"{tc.data_url()}/rest/v1/movies",
            params={
                "select": "tmdb_id,title,poster_path,release_year,has_vector,created_at",
                "order": "created_at.desc",
                "limit": str(limit),
            },
            headers=tc.sb_headers(),
        )
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Supabase 조회 실패: {r.text[:200]}")
        return {"movies": r.json()}
```

> 라우트 순서 주의: FastAPI는 경로를 등록 순서로 매칭한다. `/api/movies/recent`는 `/api/movies/{tmdb_id}/detail`·`/api/movies/{tmdb_id}`보다 **먼저** 선언되어야 `recent`가 `{tmdb_id}`로 오인되지 않는다. (위 위치를 지키면 됨.)

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd 4K_BE && python -m pytest tests/test_main_recent.py -v`
Expected: 2 passed.

- [ ] **Step 6: 전체 BE 테스트 회귀 확인**

Run: `cd 4K_BE && python -m pytest -v`
Expected: 전체 passed (9 + 4 + 2 = 15).

- [ ] **Step 7: 커밋**

```bash
cd 4K_BE
git add app/main.py tests/test_main_recent.py
git commit -m "feat(be): /api/movies/recent 추가 + tmdb_common 재사용"
```

---

## Task 5: CronJob 매니페스트 + kustomization 등록

**Files:**
- Create: `Ansible/manifests/4k-be/backfill-cronjob.yaml`
- Modify: `Ansible/manifests/4k-be/kustomization.yaml`

- [ ] **Step 1: CronJob 매니페스트 작성**

`Ansible/manifests/4k-be/backfill-cronjob.yaml`:
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: movie-backfill
  namespace: be
spec:
  schedule: "0 18 * * *"          # UTC 18:00 = KST 03:00
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      backoffLimit: 2
      template:
        spec:
          restartPolicy: OnFailure
          nodeSelector:
            workload: app
          containers:
            - name: movie-backfill
              image: ghcr.io/sanggyoon/4k-be:latest
              command: ["python", "-m", "app.backfill_popular"]
              envFrom:
                - secretRef:
                    name: 4k-be-secrets
              env:
                - name: BACKFILL_MAX_NEW
                  value: "100"
              resources:
                requests:
                  cpu: 100m
                  memory: 128Mi
                limits:
                  cpu: 300m
                  memory: 256Mi
```

- [ ] **Step 2: kustomization 에 등록**

`Ansible/manifests/4k-be/kustomization.yaml`의 `resources:` 블록에 한 줄 추가:
```yaml
resources:
  - deployment.yaml
  - service.yaml
  - backfill-cronjob.yaml
```

> 이미지 태그는 기존 `images:` 항목(`newTag`)이 CronJob의 `:latest`에도 동일 적용된다(같은 이미지명). CI가 `newTag`를 갱신하면 CronJob도 같은 이미지를 사용.

- [ ] **Step 3: 매니페스트 유효성 검증**

Run: `cd Ansible/manifests/4k-be && kubectl kustomize . > /dev/null && echo OK`
Expected: `OK` (kustomize 빌드 성공, YAML 파싱 오류 없음).
(클러스터 접근 가능하면 추가로: `kubectl apply --dry-run=client -k .`)

- [ ] **Step 4: 커밋**

```bash
git add Ansible/manifests/4k-be/backfill-cronjob.yaml Ansible/manifests/4k-be/kustomization.yaml
git commit -m "feat(infra): 영화 backfill CronJob(매일 03:00 KST) 추가"
```

---

## Task 6: FE 프록시 라우트 `/api/manager/movies/recent`

**Files:**
- Create: `4K_FE/app/api/manager/movies/recent/route.ts`

`proxy.ts` matcher가 `/api/manager/movies/:path*`를 이미 인증 보호한다(추가 작업 불필요).

- [ ] **Step 1: 프록시 라우트 작성**

`4K_FE/app/api/manager/movies/recent/route.ts`:
```typescript
const BE_URL = process.env.BE_INTERNAL_URL ?? 'http://localhost:8000';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = searchParams.get('limit') ?? '50';
  const res = await fetch(`${BE_URL}/api/movies/recent?limit=${limit}`, { cache: 'no-store' });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
```

- [ ] **Step 2: 타입체크/린트**

Run: `cd 4K_FE && npx tsc --noEmit && npx next lint`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
cd 4K_FE
git add app/api/manager/movies/recent/route.ts
git commit -m "feat(fe): 최근 추가 영화 프록시 라우트"
```

---

## Task 7: FE "최근 추가 데이터" 페이지 `/movie_list/recent`

**Files:**
- Create: `4K_FE/app/movie_list/recent/page.tsx`

`proxy.ts` matcher가 `/movie_list/:path*`를 이미 인증 보호한다.

- [ ] **Step 1: 페이지 작성**

`4K_FE/app/movie_list/recent/page.tsx`:
```typescript
'use client';

// 최근 추가 데이터 — created_at 내림차순으로 최근 채워진 영화 확인
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { posterUrl } from '@/app/lib/data';

interface RecentMovie {
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  release_year: number | null;
  has_vector: boolean;
  created_at: string;
}

export default function RecentPage() {
  const [movies, setMovies] = useState<RecentMovie[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/manager/movies/recent?limit=100');
        const data = await res.json();
        setMovies(data.movies ?? []);
      } catch {
        setMovies([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <main style={{ padding: '24px', maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 22 }}>최근 추가 데이터</h1>
        <Link href="/movie_list" style={{ color: 'var(--accent)' }}>← 영화 관리로</Link>
      </div>

      {loading ? (
        <p style={{ marginTop: 24, opacity: 0.6 }}>불러오는 중...</p>
      ) : movies.length === 0 ? (
        <p style={{ marginTop: 24, opacity: 0.6 }}>최근 추가된 영화가 없습니다.</p>
      ) : (
        <table style={{ width: '100%', marginTop: 16, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', opacity: 0.6, fontSize: 13 }}>
              <th style={{ padding: '8px 6px' }}>포스터</th>
              <th style={{ padding: '8px 6px' }}>제목</th>
              <th style={{ padding: '8px 6px' }}>연도</th>
              <th style={{ padding: '8px 6px' }}>벡터</th>
              <th style={{ padding: '8px 6px' }}>추가 시각</th>
            </tr>
          </thead>
          <tbody>
            {movies.map((m) => (
              <tr key={m.tmdb_id} style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <td style={{ padding: '6px' }}>
                  {m.poster_path ? (
                    <img src={posterUrl(m.poster_path)} alt={m.title} width={40} style={{ borderRadius: 4 }} />
                  ) : '—'}
                </td>
                <td style={{ padding: '6px' }}>{m.title}</td>
                <td style={{ padding: '6px' }}>{m.release_year ?? '—'}</td>
                <td style={{ padding: '6px' }}>
                  <span style={{
                    fontSize: 12,
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: m.has_vector ? 'rgba(34,197,94,0.85)' : 'rgba(255,255,255,0.08)',
                    color: m.has_vector ? 'black' : 'rgba(255,255,255,0.5)',
                  }}>
                    {m.has_vector ? '추천 가능' : '메타만'}
                  </span>
                </td>
                <td style={{ padding: '6px', fontSize: 13, opacity: 0.7 }}>
                  {new Date(m.created_at).toLocaleString('ko-KR')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
```

> `posterUrl`은 `app/lib/data.ts`의 기존 export를 재사용한다(`movie_list/page.tsx`와 동일 패턴).

- [ ] **Step 2: 관리 페이지에서 진입 링크 추가**

`4K_FE/app/movie_list/page.tsx`의 로그아웃 버튼 근처(헤더 영역)에 링크 한 줄 추가:
```tsx
<Link href="/movie_list/recent" style={{ color: 'var(--accent)', marginRight: 12 }}>최근 추가 데이터</Link>
```
(파일 상단에 `import Link from 'next/link';`가 없으면 추가.)

- [ ] **Step 3: 타입체크/린트/빌드**

Run: `cd 4K_FE && npx tsc --noEmit && npx next lint`
Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
cd 4K_FE
git add app/movie_list/recent/page.tsx app/movie_list/page.tsx
git commit -m "feat(fe): 최근 추가 데이터 페이지 + 진입 링크"
```

---

## Task 8: 통합 수동 검증

**Files:** 없음 (검증만)

- [ ] **Step 1: backfill 로컬 dry-run (작은 한도)**

Run:
```bash
cd 4K_BE && source .venv/bin/activate
BACKFILL_MAX_NEW=2 python -m app.backfill_popular
```
(`4K_BE/.env` 또는 `DB_SCRIPTS/.env`에 TMDB/Supabase 키 필요. main.py와 동일 키.)
Expected: `[backfill] 신규 N개 ...` 로그. 한 번 더 실행 시 동일 영화는 신규 0(멱등).

- [ ] **Step 2: recent API 확인**

Run: `cd 4K_BE && uvicorn app.main:app --port 8000` 실행 후 다른 터미널에서
`curl 'http://localhost:8000/api/movies/recent?limit=5'`
Expected: 방금 backfill로 들어간 영화가 created_at 내림차순으로 보임.

- [ ] **Step 3: FE 화면 확인**

`4K_FE`에서 `npm run dev` 후 로그인 → `/movie_list/recent` 접속 → 최근 추가 목록과 `추천 가능/메타만` 배지 표시 확인.

- [ ] **Step 4: 최종 회귀**

Run: `cd 4K_BE && python -m pytest -v`
Expected: 전체 passed.

---

## 배포 메모 (구현 범위 밖, 실제 배포 시)

- CronJob은 ArgoCD가 `Ansible/manifests/4k-be` 변경을 감지해 자동 동기화한다. main에 머지되면 CI가 BE 이미지를 빌드·푸시하고 kustomization `newTag`를 갱신 → ArgoCD가 CronJob에도 새 이미지 반영.
- 첫 실행을 기다리지 않고 즉시 테스트하려면: `kubectl create job --from=cronjob/movie-backfill movie-backfill-manual -n be`.
