# P1 — 파이프라인 자동화 + 활성버전 포인터 + 스테일 치유 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 파싱·스코어·벡터를 시간별 CronWorkflow로 무인화하되 대상을 실제 데이터에서 결산하고(자가치유), 모델 활성버전 포인터를 도입해 스코어·벡터·FE가 활성버전 기준으로 동작하게 한다.

**Architecture:** vm5 `model_versions.active` 플래그(진실)+vm4 `app_config` 미러(FE)+BE `/api/active-model`. ML 잡은 활성버전 기준으로 "출력 빠진 영화"를 결산해 처리. Argo CronWorkflow 3개가 기존 WorkflowTemplate을 시간별 호출.

**Tech Stack:** Python(httpx, pytest), Supabase REST(vm5 ai/vm4 data), Argo CronWorkflow, FastAPI(BE), Next.js(FE).

**선행 스펙:** `docs/superpowers/specs/2026-06-15-p1-pipeline-automation-design.md`

**경로:** ML=`4K_ML`, BE=`4K_BE`, FE=`4K_FE`, manifests=`Ansible/manifests/4k-ml`. git 루트=`/Users/sanggyoon/Documents/KakaoCloud_Project`. 커밋 끝:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

**테스트:** ML/BE = `cd <dir> && python -m pytest <file> -v`. FE = `cd 4K_FE && npm run build`.

---

## 사전 메모

- 활성 base 버전 문자열 예: `roberta-va-v1`. 축 버전 = `{base}::arousal` / `{base}::valence`.
- vm5 REST는 `AI_DATABASE_URL`/`AI_DATABASE_KEY`(apikey+Bearer). 큰 테이블(scenes 37k, scene_scores 57k)은 **반드시 페이지네이션**(PAGE_SIZE=1000).
- vm4 REST는 BE `tc.sb_headers()`/`tc.data_url()`(DATA_SUPABASE_*), FE는 anon.

---

## Task 1: DB 마이그레이션 (사용자가 SQL 실행) + 기록 파일

**Files:** Create `4K_ML/db/p1_migrations.sql`

- [ ] **Step 1: 마이그레이션 SQL 작성**

`4K_ML/db/p1_migrations.sql`:
```sql
-- P1 마이그레이션. vm5(ai)와 vm4(data) 각각 해당 SQL Editor에서 실행.

-- ── vm5 (ai.peakly.art) ──────────────────────────────
-- 1) 활성 모델 버전 플래그
ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT false;
UPDATE model_versions SET active = true  WHERE model_version = 'roberta-va-v1';
UPDATE model_versions SET active = false WHERE model_version <> 'roberta-va-v1';

-- 2) 고아 scene_scores 정리(재파싱 잔재: 현재 scenes에 없는 scenes_id)
DELETE FROM scene_scores ss WHERE NOT EXISTS (SELECT 1 FROM scenes s WHERE s.id = ss.scenes_id);

-- ── vm4 (data.peakly.art) ────────────────────────────
-- 3) FE용 활성버전 미러 (anon SELECT 허용 필요)
CREATE TABLE IF NOT EXISTS app_config (
  key   text PRIMARY KEY,
  value text NOT NULL
);
INSERT INTO app_config (key, value) VALUES ('active_model_version', 'roberta-va-v1')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
-- RLS가 켜져 있으면 anon read 정책 추가:
-- ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY app_config_read ON app_config FOR SELECT TO anon USING (true);
```

- [ ] **Step 2: 적용 (사용자)**

- vm5 Studio에서 §1·§2, vm4 Studio에서 §3 실행.
- 확인: `curl ".../rest/v1/app_config?key=eq.active_model_version&select=value" -H "apikey: <vm4 anon>"` → `[{"value":"roberta-va-v1"}]`.

- [ ] **Step 3: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_ML/db/p1_migrations.sql
git commit -m "docs(P1): DB 마이그레이션 SQL (active 플래그·app_config·고아 정리)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: BE `/api/active-model`

**Files:** Modify `4K_BE/app/main.py` · Test `4K_BE/tests/test_active_model.py`

- [ ] **Step 1: 실패 테스트 작성**

`4K_BE/tests/test_active_model.py`:
```python
import httpx
from fastapi.testclient import TestClient
from app import main


def _patch(monkeypatch, handler):
    orig = httpx.AsyncClient

    def factory(*a, **k):
        k.pop("timeout", None); k.pop("verify", None)
        return orig(transport=httpx.MockTransport(handler))

    monkeypatch.setattr(main.httpx, "AsyncClient", factory)


def test_active_model_returns_base_version(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "http://vm5")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")

    def handler(req):
        if "/rest/v1/model_versions" in str(req.url):
            return httpx.Response(200, json=[{"model_version": "roberta-va-v1"}])
        return httpx.Response(404)

    _patch(monkeypatch, handler)
    res = TestClient(main.app).get("/api/active-model")
    assert res.status_code == 200
    assert res.json()["version"] == "roberta-va-v1"


def test_active_model_fallback(monkeypatch):
    monkeypatch.delenv("AI_DATABASE_URL", raising=False)
    monkeypatch.delenv("AI_DATABASE_KEY", raising=False)

    def handler(req):
        return httpx.Response(200, json=[])

    _patch(monkeypatch, handler)
    res = TestClient(main.app).get("/api/active-model")
    assert res.status_code == 200
    assert res.json()["version"] == "roberta-va-v1"  # 폴백
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_BE && python -m pytest tests/test_active_model.py -q`
Expected: FAIL (404 / 라우트 없음)

- [ ] **Step 3: 구현 — `main.py`에 엔드포인트 추가**

`4K_BE/app/main.py`의 `_processing_counts` 정의 위(또는 `@app.get("/api/stats")` 앞)에 추가:
```python
@app.get("/api/active-model")
async def active_model():
    """현재 활성 모델 base 버전. vm5 model_versions.active=true 의 base(::없는) 버전."""
    url = os.getenv("AI_DATABASE_URL", "")
    key = os.getenv("AI_DATABASE_KEY", "")
    if url and key:
        headers = {"apikey": key, "Authorization": f"Bearer {key}"}
        bu = os.getenv("AI_BASIC_USER")
        auth = (bu, os.getenv("AI_BASIC_PASS", "")) if bu else None
        async with httpx.AsyncClient(timeout=15, verify=False) as client:
            r = await client.get(
                f"{url}/rest/v1/model_versions",
                params={"select": "model_version", "active": "eq.true"},
                headers=headers, auth=auth,
            )
            if r.status_code in (200, 206):
                for row in r.json():
                    mv = row.get("model_version", "")
                    if mv and "::" not in mv:
                        return {"version": mv}
    return {"version": "roberta-va-v1"}  # 폴백
```

- [ ] **Step 4: 통과 + 회귀**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_BE && python -m pytest tests/test_active_model.py tests/test_stats.py -q`
Expected: 통과.

- [ ] **Step 5: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_BE/app/main.py 4K_BE/tests/test_active_model.py
git commit -m "feat(P1): BE /api/active-model (vm5 active 모델 base 버전)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 스코어 타깃을 데이터 결산으로 (`serving/db.py`)

**Files:** Modify `4K_ML/serving/db.py` · Test `4K_ML/tests/test_score_targets.py`

- [ ] **Step 1: 실패 테스트 작성 (순수 selector + active 헬퍼)**

`4K_ML/tests/test_score_targets.py`:
```python
from serving.db import select_score_targets


def test_select_targets_only_missing_and_parsed():
    parse_done = {100, 200, 300}          # 300은 파싱완료지만 씬 없음
    scene_to_movie = {
        10: 100, 11: 100,                 # 100: 씬 2개
        20: 200,                          # 200: 씬 1개
        40: 400,                          # 400: 파싱 미완(parse_done 아님)
    }
    scored = {10, 11, 20}                 # 100·200은 전부 점수 있음
    assert select_score_targets(parse_done, scene_to_movie, scored) == []

    # 100의 씬 11 점수 누락 → 100만 타깃
    assert select_score_targets(parse_done, scene_to_movie, {10, 20}) == [100]

    # 400은 parse_done 아님 → 점수 없어도 제외
    assert 400 not in select_score_targets(parse_done, scene_to_movie, set())
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_ML && python -m pytest tests/test_score_targets.py -q`
Expected: FAIL (`select_score_targets` 없음)

- [ ] **Step 3: 구현 — `serving/db.py` 수정**

`serving/db.py` 상단 import 아래에 페이지네이션 헬퍼 추가(기존 `_get` 유지):
```python
def _get_all(client: httpx.Client, table: str, params: dict) -> list[dict]:
    """페이지네이션 fetch (대형 테이블용)."""
    out: list[dict] = []
    offset = 0
    while True:
        rows = _get(client, table, {**params, "limit": "1000", "offset": str(offset)})
        out.extend(rows)
        if len(rows) < 1000:
            break
        offset += 1000
    return out


def fetch_active_version(client: httpx.Client) -> str:
    """vm5 model_versions.active=true 의 base 버전(::없는). 없으면 roberta-va-v1."""
    rows = _get(client, "model_versions", {"select": "model_version", "active": "eq.true"})
    for r in rows:
        mv = r.get("model_version", "")
        if mv and "::" not in mv:
            return mv
    return "roberta-va-v1"


def select_score_targets(parse_done: set, scene_to_movie: dict, scored_scene_ids: set) -> list:
    """파싱완료 & 현재 씬 중 활성버전 점수가 하나라도 빠진 영화. (순수)"""
    movie_scenes: dict = {}
    for sid, tmdb in scene_to_movie.items():
        movie_scenes.setdefault(tmdb, []).append(sid)
    targets = []
    for tmdb, sids in movie_scenes.items():
        if tmdb not in parse_done:
            continue
        if any(sid not in scored_scene_ids for sid in sids):
            targets.append(tmdb)
    return targets
```

같은 파일의 기존 `fetch_score_targets`를 다음으로 교체:
```python
def fetch_score_targets(client: httpx.Client) -> list[int]:
    """활성버전 점수가 빠진 파싱완료 영화 (데이터 결산, 스테일 자동 치유)."""
    mv = fetch_active_version(client)
    status = _get_all(client, "processing_status", {"select": "tmdb_id,parse_state"})
    parse_done = {r["tmdb_id"] for r in status if r.get("parse_state") == "done"}
    subs = _get_all(client, "subtitles", {"select": "id,tmdb_id"})
    sub_map = {r["id"]: r["tmdb_id"] for r in subs}
    scenes = _get_all(client, "scenes", {"select": "id,subtitles_id"})
    scene_to_movie = {
        r["id"]: sub_map.get(r["subtitles_id"])
        for r in scenes if sub_map.get(r["subtitles_id"]) is not None
    }
    scored = _get_all(client, "scene_scores",
                      {"select": "scenes_id", "model_version": f"eq.{mv}::arousal"})
    scored_ids = {r["scenes_id"] for r in scored}
    return select_score_targets(parse_done, scene_to_movie, scored_ids)
```

- [ ] **Step 4: 통과 + 회귀**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_ML && python -m pytest tests/test_score_targets.py tests/test_predict_core.py -q`
Expected: 통과.

- [ ] **Step 5: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_ML/serving/db.py 4K_ML/tests/test_score_targets.py
git commit -m "feat(P1): 스코어 타깃을 활성버전 데이터 결산으로(스테일 치유)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 벡터 증분 + 활성버전 + has_vector 재동기화 (`generate_vectors`)

**Files:** Modify `4K_ML/generate_vectors/db.py`, `4K_ML/generate_vectors/generate_vectors.py` · Test `4K_ML/tests/test_vector_targets.py`, 수정 `4K_ML/tests/test_gen_run.py`

- [ ] **Step 1: 실패 테스트 작성 (순수 selector)**

`4K_ML/tests/test_vector_targets.py`:
```python
from generate_vectors.generate_vectors import select_vector_targets


def test_only_unvectored_movies():
    ar_series_keys = {100, 200, 300}
    vectored = {200}                      # 200은 이미 활성벡터 있음
    assert sorted(select_vector_targets(ar_series_keys, vectored)) == [100, 300]


def test_all_vectored_returns_empty():
    assert select_vector_targets({1, 2}, {1, 2}) == []
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_ML && python -m pytest tests/test_vector_targets.py -q`
Expected: FAIL (`select_vector_targets` 없음)

- [ ] **Step 3: `generate_vectors/db.py`에 활성버전·기존벡터·has_vector 보정 헬퍼 추가**

`generate_vectors/db.py` 끝에 추가:
```python
def fetch_active_version(client: httpx.Client) -> str:
    """vm5 model_versions.active=true base 버전. 없으면 roberta-va-v1."""
    url, _ = _ai()
    r = client.get(f"{url}/rest/v1/model_versions",
                   params={"select": "model_version", "active": "eq.true"},
                   headers=_ai_headers(), auth=_ai_auth(), timeout=60)
    if r.status_code in (200, 206):
        for row in r.json():
            mv = row.get("model_version", "")
            if mv and "::" not in mv:
                return mv
    return "roberta-va-v1"


def fetch_vectored_tmdbs(client: httpx.Client, version_axis: str) -> set:
    """vm4 movie_vectors에 해당 버전이 이미 있는 tmdb_id 집합."""
    url, _ = _data()
    out: set = set()
    offset = 0
    while True:
        r = client.get(f"{url}/rest/v1/movie_vectors",
                       params={"select": "tmdb_id", "vector_version": f"eq.{version_axis}",
                               "limit": 1000, "offset": offset},
                       headers={"apikey": _data()[1], "Authorization": f"Bearer {_data()[1]}"},
                       auth=_data_auth(), timeout=60)
        if r.status_code not in (200, 206):
            break
        rows = r.json()
        out.update(x["tmdb_id"] for x in rows)
        if len(rows) < 1000:
            break
        offset += 1000
    return out


def reconcile_has_vector(client: httpx.Client, active_tmdbs: set) -> None:
    """vm4 movies.has_vector를 활성벡터 보유 집합 기준으로 보정.
    has_vector=true 인데 활성벡터 없는 영화 → false."""
    url, _ = _data()
    rows: list[dict] = []
    offset = 0
    while True:
        r = client.get(f"{url}/rest/v1/movies",
                       params={"select": "tmdb_id", "has_vector": "eq.true",
                               "limit": 1000, "offset": offset},
                       headers={"apikey": _data()[1], "Authorization": f"Bearer {_data()[1]}"},
                       auth=_data_auth(), timeout=60)
        if r.status_code not in (200, 206):
            break
        batch = r.json()
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    stale = [r["tmdb_id"] for r in rows if r["tmdb_id"] not in active_tmdbs]
    for i in range(0, len(stale), BATCH_SIZE):
        chunk = stale[i:i + BATCH_SIZE]
        ids = ",".join(str(t) for t in chunk)
        client.patch(f"{url}/rest/v1/movies",
                     params={"tmdb_id": f"in.({ids})"},
                     json={"has_vector": False},
                     headers=_data_headers(), auth=_data_auth(), timeout=60)
```

- [ ] **Step 4: `generate_vectors.py` — 활성버전 + 증분 + 재동기화**

`generate_vectors/generate_vectors.py`에서 모듈 상수 블록(`MODEL_VERSION = ...` ~ `SMOOTHING = ...`)을 다음으로 교체:
```python
SMOOTHING = f"savgol_w{transform.SAVGOL_WINDOW}_p{transform.SAVGOL_POLY}"


def select_vector_targets(ar_series_keys, vectored: set) -> list:
    """활성 점수는 있는데 활성벡터가 없는 영화. (순수)"""
    return [t for t in ar_series_keys if t not in vectored]
```

`build_rows` 시그니처를 버전 인자로 바꾸고 본문의 버전 문자열을 인자 기반으로:
```python
def build_rows(ar_series: dict, va_series: dict, model_version: str) -> tuple[list, set]:
    """arousal 유효 영화만 적재. (rows, done) 반환. (순수)"""
    arousal_mv = f"{model_version}::arousal"
    valence_mv = f"{model_version}::valence"
    rows: list = []
    done: set = set()
    for tmdb_id, pts in ar_series.items():
        av = transform.process_axis(pts, "arousal")
        if av is None:
            continue
        rows.append({"tmdb_id": tmdb_id, "vector": av, "vector_version": arousal_mv,
                     "normalization": "zscore", "smoothing_method": SMOOTHING})
        vpts = va_series.get(tmdb_id)
        if vpts:
            vv = transform.process_axis(vpts, "valence")
            if vv is not None:
                rows.append({"tmdb_id": tmdb_id, "vector": vv, "vector_version": valence_mv,
                             "normalization": "raw", "smoothing_method": SMOOTHING})
        done.add(tmdb_id)
    return rows, done
```

`run()`을 다음으로 교체(활성버전 조회 + 증분 타깃 + 재동기화):
```python
def run() -> None:
    if not os.getenv("AI_DATABASE_URL") or not os.getenv("AI_DATABASE_KEY"):
        raise SystemExit("AI_DATABASE_URL, AI_DATABASE_KEY 필요 (vm5).")
    if not os.getenv("DATA_SUPABASE_URL") or not os.getenv("DATA_SUPABASE_KEY"):
        raise SystemExit("DATA_SUPABASE_URL, DATA_SUPABASE_KEY 필요 (vm4).")

    with httpx.Client(timeout=60, verify=False) as client:
        mv = db.fetch_active_version(client)
        arousal_mv = f"{mv}::arousal"
        print(f"=== 활성 모델: {mv} ===")

        scene_index = db.fetch_scene_index(client)
        ar_scores = db.fetch_axis_scores(client, arousal_mv)
        va_scores = db.fetch_axis_scores(client, f"{mv}::valence")
        ar_series = db.build_series(ar_scores, scene_index)
        va_series = db.build_series(va_scores, scene_index)

        vectored = db.fetch_vectored_tmdbs(client, arousal_mv)
        targets = set(select_vector_targets(ar_series.keys(), vectored))
        ar_t = {t: ar_series[t] for t in targets}
        va_t = {t: va_series[t] for t in targets if t in va_series}
        print(f"  점수 보유 {len(ar_series):,} / 기존 벡터 {len(vectored):,} / 신규 대상 {len(ar_t):,}")

        rows, done = build_rows(ar_t, va_t, mv)
        print(f"  벡터 행 {len(rows):,} / 신규 적재 {len(done):,}")
        db.upsert_vectors(client, rows)
        db.set_has_vector(client, list(done))
        db.set_vector_state(client, list(done))

        # has_vector 재동기화: 활성벡터 보유 = 기존 ∪ 신규
        db.reconcile_has_vector(client, vectored | done)
        print("✅ 완료")
```

- [ ] **Step 5: 기존 `test_gen_run.py` 업데이트 (build_rows 시그니처 변경)**

`4K_ML/tests/test_gen_run.py`에서 `build_rows(ar, va)` 호출을 `build_rows(ar, va, "roberta-va-v1")`로 바꾸고, 단언의 버전 문자열은 그대로(roberta-va-v1::arousal/valence) 유지.

- [ ] **Step 6: 통과 + 회귀**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_ML && python -m pytest tests/test_vector_targets.py tests/test_gen_run.py tests/test_gen_db.py -q`
Expected: 통과.

- [ ] **Step 7: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_ML/generate_vectors/db.py 4K_ML/generate_vectors/generate_vectors.py 4K_ML/tests/test_vector_targets.py 4K_ML/tests/test_gen_run.py
git commit -m "feat(P1): 벡터 증분 생성 + 활성버전 + has_vector 재동기화

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: FE 활성버전 동적 읽기 (`data.ts`)

**Files:** Modify `4K_FE/app/lib/data.ts`

- [ ] **Step 1: 활성버전 로더 추가 (vector 함수들 위에)**

`4K_FE/app/lib/data.ts`에 추가(SUPABASE_URL/KEY 정의 아래):
```ts
// 활성 모델 버전 — vm4 app_config 미러에서 1회 읽어 캐시. 실패 시 폴백.
let _activeVersion: string | null = null;
export async function getActiveVersion(): Promise<string> {
  if (_activeVersion) return _activeVersion;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/app_config?key=eq.active_model_version&select=value&limit=1`,
      { headers: { apikey: SUPABASE_ANON_KEY } },
    );
    if (res.ok) {
      const rows = (await res.json()) as { value: string }[];
      if (rows.length && rows[0].value) {
        _activeVersion = rows[0].value;
        return _activeVersion;
      }
    }
  } catch { /* empty */ }
  _activeVersion = 'roberta-va-v1';
  return _activeVersion;
}
```

- [ ] **Step 2: `fetchVectorPair` 활성버전 사용**

`fetchVectorPair`의 URL 라인을 교체:
```ts
    const av = await getActiveVersion();
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/movie_vectors?tmdb_id=eq.${tmdbId}&vector_version=in.(${av}::arousal,${av}::valence)&select=vector_version,vector`,
      { headers: { apikey: SUPABASE_ANON_KEY } },
    );
```
(기존 `const res = await fetch(\`...roberta-va-v1::arousal,roberta-va-v1::valence...\`)` 한 줄을 위 두 부분으로. `try {` 바로 다음에 `const av = await getActiveVersion();` 삽입 후 URL의 하드코딩 버전을 `${av}`로.)

- [ ] **Step 3: `fetchMovieVectorPairs` 활성버전 사용**

`fetchMovieVectorPairs`도 동일하게 `try {` 다음에 `const av = await getActiveVersion();` 추가하고 URL의 `roberta-va-v1`(arousal/valence 2곳)을 `${av}`로 교체:
```ts
    const av = await getActiveVersion();
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/movie_vectors?tmdb_id=in.(${tmdbIds.join(',')})&vector_version=in.(${av}::arousal,${av}::valence)&select=tmdb_id,vector_version,vector`,
      { headers: { apikey: SUPABASE_ANON_KEY } },
    );
```

- [ ] **Step 4: 빌드**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE && npm run build 2>&1 | grep -E "Compiled|Failed|Error"`
Expected: `✓ Compiled successfully`

- [ ] **Step 5: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/lib/data.ts
git commit -m "feat(P1): FE가 app_config 활성버전을 읽어 벡터 필터(하드코딩 제거)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: CronWorkflow 3개

**Files:** Create `Ansible/manifests/4k-ml/cronworkflow-parse.yaml`, `-score.yaml`, `-vector.yaml`

- [ ] **Step 1: 파싱 크론**

`Ansible/manifests/4k-ml/cronworkflow-parse.yaml`:
```yaml
# P1 자동화 — 매시 :05 파싱(subtitle done & parse 미완). 겹침 금지.
apiVersion: argoproj.io/v1alpha1
kind: CronWorkflow
metadata:
  name: parse-hourly
  namespace: ai
spec:
  schedule: "5 * * * *"
  concurrencyPolicy: Forbid
  startingDeadlineSeconds: 300
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  workflowSpec:
    workflowTemplateRef:
      name: subtitle-parse
```

- [ ] **Step 2: 스코어 크론**

`Ansible/manifests/4k-ml/cronworkflow-score.yaml`: 위와 동일 구조로 `name: score-hourly`, `schedule: "20 * * * *"`, `workflowTemplateRef: { name: score-scenes }`.

- [ ] **Step 3: 벡터 크론**

`Ansible/manifests/4k-ml/cronworkflow-vector.yaml`: `name: vector-hourly`, `schedule: "40 * * * *"`, `workflowTemplateRef: { name: generate-vectors }`.

- [ ] **Step 4: CronWorkflow RBAC/CRD 확인 (배포 시)**

- `kubectl get crd cronworkflows.argoproj.io` 존재 확인(없으면 Argo 재설치 필요 — 배포 단계 안내).
- argo-workflow/argo controller SA가 cronworkflows를 다룰 권한 확인. 없으면 Role 추가(배포 시).
- CronWorkflow 파일엔 이미지가 없어(WT 참조) CI 태그 bump 대상 아님 — `.github/workflows` 변경 불필요.

- [ ] **Step 5: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add Ansible/manifests/4k-ml/cronworkflow-parse.yaml Ansible/manifests/4k-ml/cronworkflow-score.yaml Ansible/manifests/4k-ml/cronworkflow-vector.yaml
git commit -m "feat(P1): 파싱·스코어·벡터 CronWorkflow (시간별, Forbid)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: 마무리 + 배포 안내

**Files:** (없음)

- [ ] **Step 1: 전체 테스트**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_ML && python -m pytest tests/ -q
cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_BE && python -m pytest -q
cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE && npm run build 2>&1 | grep -E "Compiled|Failed|Error"
```
Expected: ML/BE 통과, FE Compiled.

- [ ] **Step 2: 배포 전 사용자 작업 (안내)**

1. Task 1 SQL 실행(vm5 active·고아정리, vm4 app_config).
2. main 병합·push → CI가 4k-ml/4k-be/4k-fe 빌드, ArgoCD가 CronWorkflow·WT 동기화.
3. `kubectl get cronworkflow -n ai` 로 3개 등록 확인. CRD/RBAC 없으면 보완.

- [ ] **Step 3: 배포 후 검증 (안내)**

- 스코어 크론 1회 수동: `argo submit --from cronworkflow/score-hourly -n ai` → 스테일(점수 없는) 영화 채워지는지.
- 벡터 크론 1회: `argo submit --from cronworkflow/vector-hourly -n ai` → 신규 대상만 벡터 생성, `select vector_version,count(*) from movie_vectors group by 1` 증가, has_vector 보정.
- FE에서 곡선/유사도 정상(활성버전 자동).

- [ ] **Step 4: finishing-a-development-branch**

**REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch

---

## Self-Review 메모

- **스펙 커버리지:** 활성포인터=T1(SQL)+T2(BE)+T5(FE); 스코어 결산=T3; 벡터 증분+has_vector 재동기화=T4; 고아 정리=T1; 크론=T6.
- **타입 일관성:** `fetch_active_version`(serving·generate_vectors 각자), `select_score_targets(parse_done, scene_to_movie, scored_scene_ids)`, `select_vector_targets(keys, vectored)`, `build_rows(ar, va, model_version)`(T4에서 시그니처 변경 → test_gen_run T5에서 호출 갱신), `getActiveVersion()`. 일관.
- **placeholder:** 코드 스텝 완전 코드. T1 SQL·T6 RBAC만 사용자 실행/배포 확인 분기로 명시.
- **엣지:** parse_done인데 씬 0 → 스코어 대상 아님(처리할 것 없음); 활성벡터 전부 존재 → 벡터 신규 0; app_config 못 읽으면 FE 폴백.
