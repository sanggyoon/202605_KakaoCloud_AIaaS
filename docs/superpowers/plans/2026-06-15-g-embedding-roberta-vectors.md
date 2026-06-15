# G(임베딩) — RoBERTa 점수 → movie_vectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** vm5 씬 점수(`roberta-va-v1::arousal`/`::valence`)를 영화별 200차원 타임라인 벡터로 가공해 vm4 `movie_vectors`에 적재(arousal=z-score, valence=raw)하고, Argo로 실행 + FE가 arousal 버전을 집도록 한다.

**Architecture:** `4K_ML/generate_vectors`를 패키지로 재작성 — `transform.py`(순수 변환), `db.py`(vm5 읽기·조인 + vm4 쓰기·상태), `generate_vectors.py`(run 오케스트레이션). Argo WorkflowTemplate로 클러스터 실행. vm4 RPC 2개에 버전필터 SQL 추가. FE `data.ts` 2개 fetch에 버전필터.

**Tech Stack:** Python(numpy·scipy.savgol·httpx), pytest(`pythonpath=.`), Argo WorkflowTemplate, Supabase REST(vm5 ai·vm4 data), Next.js FE(data.ts).

**선행 스펙:** `docs/superpowers/specs/2026-06-15-g-embedding-roberta-vectors-design.md`

**작업 경로:** ML=`/Users/sanggyoon/Documents/KakaoCloud_Project/4K_ML`, FE=`/Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE`, manifests=`/Users/sanggyoon/Documents/KakaoCloud_Project/Ansible/manifests/4k-ml`. git 루트=`/Users/sanggyoon/Documents/KakaoCloud_Project`. 커밋 메시지 끝:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## 사전 메모

- `4K_ML/generate_vectors/generate_vectors.py`는 **이미 존재**(EXT 더미→vm4, rule-v1). 이 작업은 그 디렉터리를 **패키지로 전환**(신규 `__init__.py`)하고 파일을 분리·재작성한다. EXT(외부 더미) 경로는 전부 제거.
- vm5 REST 패턴은 `4K_ML/serving/db.py`와 동일: `AI_DATABASE_URL`/`AI_DATABASE_KEY`(헤더 `apikey`+`Authorization: Bearer`), 선택 `AI_BASIC_*`, public 스키마. 페이지네이션 limit/offset.
- vm4 쓰기 패턴은 기존 `generate_vectors.py`의 `vm4_upsert`와 동일: `DATA_SUPABASE_URL`/`DATA_SUPABASE_KEY`, 선택 basic auth, `Prefer: resolution=merge-duplicates,return=minimal`, `verify=False`.
- 테스트 실행: `cd 4K_ML && python -m pytest tests/<file> -v` (pytest.ini가 `pythonpath=.`).
- 4k-ml 이미지에 numpy/scipy/httpx/dotenv 이미 포함(requirements.txt). Dockerfile은 repo 전체 COPY라 새 패키지 자동 포함.

상수(여러 파일 공유): `MODEL_VERSION="roberta-va-v1"`, 축 버전=`f"{MODEL_VERSION}::arousal"` / `"::valence"`. 처리 상수 `TARGET_POINTS=200`, `SAVGOL_WINDOW=11`, `SAVGOL_POLY=2`, `MIN_SCENES=5`.

---

## Task 1: `transform.py` — 순수 변환(리샘플·스무딩·정규화)

**Files:**
- Create: `4K_ML/generate_vectors/__init__.py`
- Create: `4K_ML/generate_vectors/transform.py`
- Test: `4K_ML/tests/test_gen_transform.py`

- [ ] **Step 1: 패키지 마커 생성**

`4K_ML/generate_vectors/__init__.py` 생성(빈 파일).

- [ ] **Step 2: 실패 테스트 작성**

`4K_ML/tests/test_gen_transform.py`:
```python
import numpy as np
from generate_vectors.transform import process_axis


def _peak_points():
    # 5점, 중앙(0.5)에 정점
    return [(0.0, 0.0), (0.25, 0.0), (0.5, 1.0), (0.75, 0.0), (1.0, 0.0)]


def test_arousal_zscore_centered_unit_variance():
    v = process_axis(_peak_points(), "arousal")
    assert v is not None
    arr = np.array(v)
    assert len(arr) == 200
    assert abs(arr.mean()) < 1e-6          # 평균 0
    assert abs(arr.std() - 1.0) < 1e-6     # 표준편차 1
    assert 90 <= int(arr.argmax()) <= 110  # 정점이 중앙 근처


def test_valence_raw_keeps_scale():
    v = process_axis(_peak_points(), "valence")
    assert v is not None
    arr = np.array(v)
    assert len(arr) == 200
    assert arr.min() >= -1e-9 and arr.max() <= 1.0 + 1e-9  # 0~1 유지
    assert arr.max() > 0.3                                 # 정점 살아있음
    assert arr.mean() > 1e-3                               # z-score 아님(양의 평균)


def test_flat_arousal_none_valence_raw():
    flat = [(i / 4, 0.5) for i in range(5)]
    assert process_axis(flat, "arousal") is None           # 평탄 → 스킵
    vv = process_axis(flat, "valence")
    assert vv is not None and len(vv) == 200
    assert all(abs(x - 0.5) < 1e-6 for x in vv)            # 0.5 그대로


def test_too_few_scenes_none():
    pts = [(0.0, 0.1), (0.3, 0.2), (0.6, 0.3), (1.0, 0.4)]  # 4점 < MIN_SCENES
    assert process_axis(pts, "arousal") is None
    assert process_axis(pts, "valence") is None
```

- [ ] **Step 3: 실패 확인**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_ML && python -m pytest tests/test_gen_transform.py -v`
Expected: FAIL (`ModuleNotFoundError: generate_vectors.transform` 또는 함수 없음)

- [ ] **Step 4: 구현**

`4K_ML/generate_vectors/transform.py`:
```python
"""순수 변환 — (progress, score) 시계열 → 200차원 벡터.

arousal: 고정 [0,1] 리샘플 + savgol + z-score (평탄이면 None).
valence: 고정 [0,1] 리샘플 + savgol + raw 유지.
"""
import numpy as np
from scipy.signal import savgol_filter

TARGET_POINTS = 200
SAVGOL_WINDOW = 11
SAVGOL_POLY = 2
MIN_SCENES = 5


def _resample_smooth(points: list[tuple[float, float]]) -> np.ndarray | None:
    if len(points) < MIN_SCENES:
        return None
    pts = sorted(points, key=lambda p: p[0])
    x = np.array([p[0] for p in pts], dtype=float)
    y = np.array([p[1] for p in pts], dtype=float)
    # 고정 [0,1] 그리드 — 진행도 %가 실제 영화 진행도. 범위 밖은 np.interp가 끝값으로 clamp.
    x_new = np.linspace(0.0, 1.0, TARGET_POINTS)
    y_res = np.interp(x_new, x, y)
    w = min(SAVGOL_WINDOW, len(y_res) - 1)
    if w % 2 == 0:
        w -= 1
    if w < SAVGOL_POLY + 1:
        return y_res
    return savgol_filter(y_res, window_length=w, polyorder=SAVGOL_POLY)


def process_axis(points: list[tuple[float, float]], axis: str) -> list[float] | None:
    """axis='arousal' → z-score(평탄 None) / axis='valence' → raw."""
    sm = _resample_smooth(points)
    if sm is None:
        return None
    if axis == "arousal":
        std = float(sm.std())
        if std < 1e-9:
            return None
        return ((sm - sm.mean()) / std).tolist()
    return sm.tolist()  # valence raw
```

- [ ] **Step 5: 통과 확인**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_ML && python -m pytest tests/test_gen_transform.py -v`
Expected: 4 passed

- [ ] **Step 6: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_ML/generate_vectors/__init__.py 4K_ML/generate_vectors/transform.py 4K_ML/tests/test_gen_transform.py
git commit -m "feat(G): transform — 고정[0,1] 리샘플+savgol, arousal z-score/valence raw

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `db.py` — vm5 읽기·조인 + vm4 쓰기·상태

**Files:**
- Create: `4K_ML/generate_vectors/db.py`
- Test: `4K_ML/tests/test_gen_db.py`

- [ ] **Step 1: 실패 테스트 작성 (순수 조인 + 모킹 fetch)**

`4K_ML/tests/test_gen_db.py`:
```python
from generate_vectors import db


def test_build_series_joins_score_scene_subtitle():
    scene_index = {
        10: (0.1, 100),   # scene_id → (progress, tmdb_id)
        11: (0.5, 100),
        12: (0.9, 100),
        20: (0.2, 200),
        30: (0.3, None),  # tmdb 없음 → 제외
        40: (None, 300),  # progress 없음 → 제외
    }
    scores = [
        {"scenes_id": 10, "score": 0.2},
        {"scenes_id": 11, "score": 0.8},
        {"scenes_id": 12, "score": 0.4},
        {"scenes_id": 20, "score": 0.5},
        {"scenes_id": 30, "score": 0.9},   # tmdb 없음
        {"scenes_id": 40, "score": 0.9},   # progress 없음
        {"scenes_id": 99, "score": 0.9},   # scene_index에 없음
    ]
    series = db.build_series(scores, scene_index)
    assert set(series.keys()) == {100, 200}
    assert sorted(series[100]) == [(0.1, 0.2), (0.5, 0.8), (0.9, 0.4)]
    assert series[200] == [(0.2, 0.5)]


def test_fetch_axis_scores_paginates(monkeypatch):
    calls = {"n": 0}

    class FakeResp:
        def __init__(self, data): self._d = data
        def raise_for_status(self): pass
        def json(self): return self._d

    class FakeClient:
        def get(self, url, params=None, headers=None, auth=None, timeout=None):
            # 1페이지 가득(1000) → 2페이지 1건 → 종료
            calls["n"] += 1
            if calls["n"] == 1:
                return FakeResp([{"scenes_id": i, "score": 0.5} for i in range(1000)])
            return FakeResp([{"scenes_id": 1000, "score": 0.5}])

    monkeypatch.setenv("AI_DATABASE_URL", "http://vm5")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")
    rows = db.fetch_axis_scores(FakeClient(), "roberta-va-v1::arousal")
    assert len(rows) == 1001
    assert calls["n"] == 2
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_ML && python -m pytest tests/test_gen_db.py -v`
Expected: FAIL (`generate_vectors.db` 없음)

- [ ] **Step 3: 구현**

`4K_ML/generate_vectors/db.py`:
```python
"""vm5(ai) 읽기 + vm4(data) 쓰기 — G 임베딩 전용.

env: AI_DATABASE_URL, AI_DATABASE_KEY (선택 AI_BASIC_USER/PASS)  ← vm5 읽기
     DATA_SUPABASE_URL, DATA_SUPABASE_KEY (선택 DATA_BASIC_USER/PASS) ← vm4 쓰기
"""
import os
from collections import defaultdict

import httpx

PAGE_SIZE = 1000
BATCH_SIZE = 50


# ── vm5 (ai) 읽기 ─────────────────────────────────────────────
def _ai() -> tuple[str, str]:
    return os.getenv("AI_DATABASE_URL", ""), os.getenv("AI_DATABASE_KEY", "")


def _ai_auth():
    u = os.getenv("AI_BASIC_USER")
    return (u, os.getenv("AI_BASIC_PASS", "")) if u else None


def _ai_headers() -> dict:
    _, k = _ai()
    return {"apikey": k, "Authorization": f"Bearer {k}"}


def _ai_get_all(client: httpx.Client, table: str, params: dict) -> list[dict]:
    url, _ = _ai()
    out: list[dict] = []
    offset = 0
    while True:
        r = client.get(f"{url}/rest/v1/{table}",
                       params={**params, "limit": PAGE_SIZE, "offset": offset},
                       headers=_ai_headers(), auth=_ai_auth(), timeout=60)
        r.raise_for_status()
        batch = r.json()
        out.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return out


def fetch_scene_index(client: httpx.Client) -> dict[int, tuple]:
    """scene_id → (progress_ratio, tmdb_id). scenes·subtitles 조인."""
    subs = _ai_get_all(client, "subtitles", {"select": "id,tmdb_id"})
    sub_map = {r["id"]: r["tmdb_id"] for r in subs}
    scenes = _ai_get_all(client, "scenes", {"select": "id,subtitles_id,progress_ratio"})
    return {r["id"]: (r.get("progress_ratio"), sub_map.get(r["subtitles_id"]))
            for r in scenes}


def fetch_axis_scores(client: httpx.Client, model_version_axis: str) -> list[dict]:
    """특정 축의 scene_scores 전체 (scenes_id, score)."""
    return _ai_get_all(client, "scene_scores",
                       {"select": "scenes_id,score", "model_version": f"eq.{model_version_axis}"})


def build_series(scores: list[dict], scene_index: dict[int, tuple]) -> dict[int, list]:
    """scene_scores + scene_index → {tmdb_id: [(progress, score)...]} (순수)."""
    series: dict[int, list] = defaultdict(list)
    for row in scores:
        info = scene_index.get(row["scenes_id"])
        if not info:
            continue
        progress, tmdb_id = info
        if tmdb_id is None or progress is None:
            continue
        series[tmdb_id].append((float(progress), float(row["score"])))
    return dict(series)


# ── vm4 (data) 쓰기 ───────────────────────────────────────────
def _data() -> tuple[str, str]:
    return os.getenv("DATA_SUPABASE_URL", ""), os.getenv("DATA_SUPABASE_KEY", "")


def _data_auth():
    u = os.getenv("DATA_BASIC_USER")
    return (u, os.getenv("DATA_BASIC_PASS", "")) if u else None


def _data_headers(write: bool = True) -> dict:
    _, k = _data()
    h = {"apikey": k, "Authorization": f"Bearer {k}"}
    if write:
        h["Content-Type"] = "application/json"
        h["Prefer"] = "resolution=merge-duplicates,return=minimal"
    return h


def upsert_vectors(client: httpx.Client, rows: list[dict]) -> None:
    """vm4 movie_vectors 배치 upsert (on_conflict=tmdb_id,vector_version)."""
    url, _ = _data()
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        r = client.post(f"{url}/rest/v1/movie_vectors",
                        params={"on_conflict": "tmdb_id,vector_version"},
                        json=batch, headers=_data_headers(), auth=_data_auth(),
                        timeout=60)
        if r.status_code not in (200, 201, 204):
            raise RuntimeError(f"vm4 upsert 실패 {r.status_code}: {r.text[:300]}")


def set_has_vector(client: httpx.Client, tmdb_ids: list[int]) -> None:
    """vm4 movies.has_vector=true 배치 (트리거 없을 때 대비; 멱등)."""
    url, _ = _data()
    for i in range(0, len(tmdb_ids), BATCH_SIZE):
        chunk = tmdb_ids[i:i + BATCH_SIZE]
        ids = ",".join(str(t) for t in chunk)
        r = client.patch(f"{url}/rest/v1/movies",
                         params={"tmdb_id": f"in.({ids})"},
                         json={"has_vector": True},
                         headers=_data_headers(), auth=_data_auth(), timeout=60)
        if r.status_code not in (200, 204):
            raise RuntimeError(f"vm4 has_vector 실패 {r.status_code}: {r.text[:300]}")


def set_vector_state(client: httpx.Client, tmdb_ids: list[int]) -> None:
    """vm5 processing_status.vector_state='done' 배치 (멱등 원장)."""
    url, _ = _ai()
    for i in range(0, len(tmdb_ids), BATCH_SIZE):
        chunk = tmdb_ids[i:i + BATCH_SIZE]
        ids = ",".join(str(t) for t in chunk)
        h = {**_ai_headers(), "Content-Type": "application/json", "Prefer": "return=minimal"}
        r = client.patch(f"{url}/rest/v1/processing_status",
                         params={"tmdb_id": f"in.({ids})"},
                         json={"vector_state": "done"},
                         headers=h, auth=_ai_auth(), timeout=60)
        if r.status_code not in (200, 204):
            raise RuntimeError(f"vm5 vector_state 실패 {r.status_code}: {r.text[:300]}")
```

- [ ] **Step 4: 통과 확인**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_ML && python -m pytest tests/test_gen_db.py -v`
Expected: 2 passed

- [ ] **Step 5: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_ML/generate_vectors/db.py 4K_ML/tests/test_gen_db.py
git commit -m "feat(G): db — vm5 읽기/조인 + vm4 movie_vectors upsert·has_vector·vector_state

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `generate_vectors.py` — run() 오케스트레이션 재작성

**Files:**
- Modify(전면 재작성): `4K_ML/generate_vectors/generate_vectors.py`
- Test: `4K_ML/tests/test_gen_run.py`

- [ ] **Step 1: 실패 테스트 작성 (행 생성 로직)**

`4K_ML/tests/test_gen_run.py`:
```python
from generate_vectors.generate_vectors import build_rows


def test_build_rows_arousal_required_valence_optional():
    # 정점 시계열(유효) + 평탄 valence
    peak = [(0.0, 0.0), (0.25, 0.0), (0.5, 1.0), (0.75, 0.0), (1.0, 0.0)]
    flat = [(i / 4, 0.5) for i in range(5)]
    ar = {100: peak, 200: peak, 300: [(0.0, 0.5)] * 5}  # 300은 arousal 평탄→스킵
    va = {100: peak, 200: flat, 300: peak}
    rows, done = build_rows(ar, va)

    versions = {(r["tmdb_id"], r["vector_version"]) for r in rows}
    # 100: arousal+valence 둘 다
    assert (100, "roberta-va-v1::arousal") in versions
    assert (100, "roberta-va-v1::valence") in versions
    # 200: arousal + valence(평탄이어도 raw 저장)
    assert (200, "roberta-va-v1::arousal") in versions
    assert (200, "roberta-va-v1::valence") in versions
    # 300: arousal 평탄 → 어떤 행도 없음
    assert all(r["tmdb_id"] != 300 for r in rows)
    assert done == {100, 200}

    # 메타 필드 확인
    a = next(r for r in rows if r["tmdb_id"] == 100 and r["vector_version"].endswith("arousal"))
    assert a["normalization"] == "zscore" and len(a["vector"]) == 200
    v = next(r for r in rows if r["tmdb_id"] == 100 and r["vector_version"].endswith("valence"))
    assert v["normalization"] == "raw" and len(v["vector"]) == 200
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_ML && python -m pytest tests/test_gen_run.py -v`
Expected: FAIL (`build_rows` 없음)

- [ ] **Step 3: 구현 (파일 전체 교체)**

`4K_ML/generate_vectors/generate_vectors.py` 전체를 다음으로 교체:
```python
#!/usr/bin/env python3
"""G — vm5 roberta 씬 점수 → vm4 movie_vectors (arousal z-score / valence raw).

env: AI_DATABASE_URL, AI_DATABASE_KEY (vm5)  /  DATA_SUPABASE_URL, DATA_SUPABASE_KEY (vm4)
실행: python -m generate_vectors.generate_vectors
"""
import os

import httpx

from generate_vectors import db, transform

MODEL_VERSION = "roberta-va-v1"
AROUSAL_MV = f"{MODEL_VERSION}::arousal"
VALENCE_MV = f"{MODEL_VERSION}::valence"
SMOOTHING = f"savgol_w{transform.SAVGOL_WINDOW}_p{transform.SAVGOL_POLY}"


def build_rows(ar_series: dict[int, list], va_series: dict[int, list]) -> tuple[list[dict], set]:
    """arousal 유효 영화만 적재. (rows, done_tmdb_ids) 반환. (순수)"""
    rows: list[dict] = []
    done: set = set()
    for tmdb_id, pts in ar_series.items():
        av = transform.process_axis(pts, "arousal")
        if av is None:
            continue  # arousal 평탄/씬부족 → 영화 스킵
        rows.append({
            "tmdb_id": tmdb_id, "vector": av, "vector_version": AROUSAL_MV,
            "normalization": "zscore", "smoothing_method": SMOOTHING,
        })
        vpts = va_series.get(tmdb_id)
        if vpts:
            vv = transform.process_axis(vpts, "valence")
            if vv is not None:
                rows.append({
                    "tmdb_id": tmdb_id, "vector": vv, "vector_version": VALENCE_MV,
                    "normalization": "raw", "smoothing_method": SMOOTHING,
                })
        done.add(tmdb_id)
    return rows, done


def run() -> None:
    if not os.getenv("AI_DATABASE_URL") or not os.getenv("AI_DATABASE_KEY"):
        raise SystemExit("AI_DATABASE_URL, AI_DATABASE_KEY 필요 (vm5).")
    if not os.getenv("DATA_SUPABASE_URL") or not os.getenv("DATA_SUPABASE_KEY"):
        raise SystemExit("DATA_SUPABASE_URL, DATA_SUPABASE_KEY 필요 (vm4).")

    with httpx.Client(timeout=60, verify=False) as client:
        print("=== vm5 읽기 ===")
        scene_index = db.fetch_scene_index(client)
        print(f"  scenes 인덱스: {len(scene_index):,}")
        ar_scores = db.fetch_axis_scores(client, AROUSAL_MV)
        va_scores = db.fetch_axis_scores(client, VALENCE_MV)
        print(f"  arousal 점수 {len(ar_scores):,} / valence 점수 {len(va_scores):,}")

        ar_series = db.build_series(ar_scores, scene_index)
        va_series = db.build_series(va_scores, scene_index)
        print(f"  영화(arousal): {len(ar_series):,}")

        print("=== 변환 ===")
        rows, done = build_rows(ar_series, va_series)
        print(f"  벡터 행 {len(rows):,} / 적재 영화 {len(done):,} (스킵 {len(ar_series) - len(done):,})")

        print("=== vm4 적재 ===")
        db.upsert_vectors(client, rows)
        db.set_has_vector(client, list(done))
        db.set_vector_state(client, list(done))
        print("✅ 완료")


if __name__ == "__main__":
    run()
```

- [ ] **Step 4: 통과 확인**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_ML && python -m pytest tests/test_gen_run.py -v`
Expected: 1 passed

- [ ] **Step 5: 전체 4K_ML 테스트 회귀 확인**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_ML && python -m pytest tests/ -q`
Expected: 기존 테스트 + 신규 7개 모두 통과(실패 0).

- [ ] **Step 6: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_ML/generate_vectors/generate_vectors.py 4K_ML/tests/test_gen_run.py
git commit -m "feat(G): run — arousal 필수/valence 선택 행 생성 + vm4 적재 오케스트레이션

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Argo WorkflowTemplate `generate-vectors`

**Files:**
- Create: `Ansible/manifests/4k-ml/workflowtemplate-generate-vectors.yaml`

- [ ] **Step 1: WorkflowTemplate 작성**

`Ansible/manifests/4k-ml/workflowtemplate-generate-vectors.yaml`:
```yaml
# G(임베딩) — vm5 roberta 점수 → vm4 movie_vectors. GPU 불필요.
# 제출: argo submit --from workflowtemplate/generate-vectors -n ai
apiVersion: argoproj.io/v1alpha1
kind: WorkflowTemplate
metadata:
  name: generate-vectors
  namespace: ai
spec:
  serviceAccountName: argo-workflow
  entrypoint: main
  templates:
    - name: main
      container:
        image: ghcr.io/sanggyoon/4k-ml:a9661d1
        command: ["python", "-m", "generate_vectors.generate_vectors"]
        envFrom:
          - secretRef:
              name: 4k-ml-secrets
```

- [ ] **Step 2: CI 이미지 태그 bump 글롭 확인**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project && grep -rn "workflowtemplate" .github/workflows/ 2>/dev/null`
- CI sed가 `Ansible/manifests/4k-ml/workflowtemplate-*.yaml` 같은 글롭으로 4k-ml 이미지 태그를 일괄 bump하면 새 파일도 자동 포함됨(확인만).
- 글롭이 특정 파일을 나열하는 방식이면, 새 파일 `workflowtemplate-generate-vectors.yaml`을 그 목록에 추가하도록 워크플로 YAML을 수정(정확한 라인은 grep 결과로 확인 후 편집).

- [ ] **Step 3: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add Ansible/manifests/4k-ml/workflowtemplate-generate-vectors.yaml .github/workflows/ 2>/dev/null
git commit -m "feat(G): generate-vectors Argo WorkflowTemplate (CPU)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: FE — arousal 버전 필터

**Files:**
- Modify: `4K_FE/app/lib/data.ts` (`fetchMovieVectors`, `fetchVector`)

- [ ] **Step 1: `fetchMovieVectors`에 버전 필터 추가**

`4K_FE/app/lib/data.ts`에서 `fetchMovieVectors`의 URL을 교체:
```ts
      `${SUPABASE_URL}/rest/v1/movie_vectors?tmdb_id=in.(${tmdbIds.join(',')})&vector_version=eq.roberta-va-v1::arousal&select=tmdb_id,vector`,
```

- [ ] **Step 2: `fetchVector`에 버전 필터 추가**

같은 파일 `fetchVector`의 URL을 교체:
```ts
      `${SUPABASE_URL}/rest/v1/movie_vectors?tmdb_id=eq.${tmdbId}&vector_version=eq.roberta-va-v1::arousal&select=vector&limit=1`,
```

> `::`는 URL에서 안전하지만, 혹시 PostgREST 파싱 이슈가 보이면 `roberta-va-v1%3A%3Aarousal`로 인코딩. 구현 시 한 건 호출해 200 + 배열 반환 확인.

- [ ] **Step 3: FE 빌드(타입체크)**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE && npm run build 2>&1 | grep -E "Compiled|Failed|Error"`
Expected: `✓ Compiled successfully`

- [ ] **Step 4: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/lib/data.ts
git commit -m "feat(G): FE가 movie_vectors의 roberta-va-v1::arousal 버전을 집도록 필터

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: vm4 RPC 버전 필터 SQL (사용자가 vm4에서 실행)

**Files:**
- Create: `4K_ML/db/rpc_arousal_version_filter.sql` (적용한 SQL 기록용)

> RPC 본문은 vm4 Supabase DB에 있어 repo에 없음. **먼저 현재 정의를 떠서 확인**한 뒤 버전필터를 삽입한다. 추측 금지.

- [ ] **Step 1: 현재 함수 정의 덤프 (Supabase Studio SQL Editor, vm4)**

다음 SQL로 두 함수의 실제 본문을 확인:
```sql
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname IN ('find_preferred_movies', 'find_similar_movies');
```
- 본문에서 `movie_vectors`를 참조(보통 `... FROM movie_vectors mv ...` + `mv.vector <=> ...` 코사인)하는 부분을 찾는다.

- [ ] **Step 2: 버전 필터 삽입한 SQL 작성 → 파일로 기록**

각 함수의 `movie_vectors` 조회 WHERE 절(또는 JOIN 조건)에 다음을 AND로 추가:
```sql
AND mv.vector_version = 'roberta-va-v1::arousal'
```
(별칭이 다르면 실제 별칭에 맞춤. 후보·쿼리 양쪽 movie_vectors 참조 모두에 적용.)

덤프+수정한 `CREATE OR REPLACE FUNCTION ...` 전체를 `4K_ML/db/rpc_arousal_version_filter.sql`에 저장(기록·재현용).

- [ ] **Step 3: vm4에 적용**

위 `CREATE OR REPLACE FUNCTION` 들을 vm4 SQL Editor에서 실행.

- [ ] **Step 4: 검증 (G 실행 후)**

- vm4에 `roberta-va-v1::arousal` 행이 생긴 뒤, FE 유사 추천이 정상 후보를 반환하는지 확인(빈 결과면 별칭/필터 위치 재점검).

- [ ] **Step 5: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_ML/db/rpc_arousal_version_filter.sql
git commit -m "docs(G): vm4 RPC arousal 버전필터 SQL 기록

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: 마무리 + 배포/실행 안내

**Files:** (없음 — 검증/배포)

- [ ] **Step 1: 전체 테스트 재확인**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_ML && python -m pytest tests/ -q`
Expected: 전부 통과.

- [ ] **Step 2: 배포 전 사용자 클러스터 작업 (안내 — 코드 아님)**

- `4k-ml-secrets`(ns ai)에 vm4 자격증명 추가:
  `kubectl -n ai patch secret 4k-ml-secrets --type merge -p '{"stringData":{"DATA_SUPABASE_URL":"https://data.peakly.art","DATA_SUPABASE_KEY":"<vm4 service_role>"}}'` (basic auth 쓰면 `DATA_BASIC_USER/PASS`도).
- vm4 `movie_vectors`에 unique constraint 있는지 확인(없으면):
  `ALTER TABLE movie_vectors ADD CONSTRAINT movie_vectors_tmdb_id_version_key UNIQUE (tmdb_id, vector_version);`

- [ ] **Step 3: finishing-a-development-branch**

**REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch
(테스트=pytest 통과 + FE 빌드 통과로 게이트 갈음 → 병합/PR 옵션 제시.)

- [ ] **Step 4: 배포 후 실행 (안내 — main 병합·push 이후)**

1. CI가 4k-ml 이미지 빌드 + WT 태그 bump → ArgoCD가 `generate-vectors` WT 동기화.
2. vm4 RPC SQL 적용(Task 6) + 시크릿/제약(Step 2) 완료 확인.
3. Argo 실행: `argo submit --from workflowtemplate/generate-vectors -n ai` (또는 Argo UI).
4. 검증: `curl ".../rest/v1/movie_vectors?vector_version=eq.roberta-va-v1::arousal&select=tmdb_id&limit=1"` 행 존재, arousal 벡터에 음수 포함·valence 0~1, FE에서 곡선/유사도 동작.

---

## Self-Review 메모

- **스펙 커버리지:** §2 결정1(2행 별도)=T3, 결정2(arousal z/valence raw)=T1, 결정3(고정[0,1]+savgol)=T1, 결정4(vm5→vm4)=T2, 결정5(Argo)=T4, 결정6(rule-v1 보존)=업서트 신규버전(삭제 없음, T2/T3), 결정7(가중유사도)=FE 다음 sub-project(범위밖 명시). §6 has_vector/vector_state=T2(db)+T3(run). §7 RPC=T6. §8 FE 필터=T5.
- **타입 일관성:** `process_axis(points, axis)`·`build_series(scores, scene_index)`·`build_rows(ar_series, va_series)→(rows,done)`·`upsert_vectors/set_has_vector/set_vector_state` 시그니처가 정의 Task와 사용 Task(run)에서 일치. 버전 문자열 `roberta-va-v1::arousal`/`::valence` 전 파일 동일.
- **placeholder:** 코드 스텝 전부 완전 코드. T6만 본질적으로 라이브 DB 본문 의존이라 "덤프 후 수정" 절차로 명시(추측 금지).
