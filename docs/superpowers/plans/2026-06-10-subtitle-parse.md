# 자막 파싱 (대사/씬 분리) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** vm5 `subtitles.raw_text`(.srt)를 대사(dialogues)와 씬(scenes)으로 파싱·저장하는 4K_ML CLI 배치를 만든다. 씬 분할은 무발화 gap + sentence-transformer 문맥 유사도 하이브리드.

**Architecture:** `4K_ML/subtitle_parse/`에 순수 모듈(srt 파서 / 피처 / 씬분할)과 IO 모듈(임베딩 / vm5 REST)을 분리. 순수 로직은 TDD 유닛 테스트, vm5 IO·오케스트레이션은 httpx MockTransport로 테스트, 임베딩 모델은 lazy 로드(테스트에서 모킹).

**Tech Stack:** Python 3.11, sentence-transformers(all-MiniLM-L6-v2)+torch, numpy, httpx(sync), pytest.

**Spec:** `docs/superpowers/specs/2026-06-10-subtitle-parse-design.md`

**작업 디렉터리:** `4K_ML/`에서 실행. 커밋은 리포 루트.

---

## File Structure

- Create: `4K_ML/subtitle_parse/__init__.py`
- Create: `4K_ML/subtitle_parse/srt.py` — `.srt → list[Cue]`
- Create: `4K_ML/subtitle_parse/features.py` — cue별 피처
- Create: `4K_ML/subtitle_parse/scenes.py` — 하이브리드 씬 분할
- Create: `4K_ML/subtitle_parse/embed.py` — all-MiniLM 임베딩(lazy)
- Create: `4K_ML/subtitle_parse/db.py` — vm5 REST 입출력
- Create: `4K_ML/subtitle_parse/parse_subtitles.py` — 배치 메인
- Modify: `4K_ML/requirements.txt` — `sentence-transformers` 추가
- Test: `4K_ML/tests/test_srt.py`, `test_features.py`, `test_scenes.py`, `test_parse_db.py`, `test_parse_main.py`

---

## Task 1: 의존성 + 패키지 스캐폴딩

**Files:**
- Modify: `4K_ML/requirements.txt`
- Create: `4K_ML/subtitle_parse/__init__.py`

- [ ] **Step 1: requirements에 sentence-transformers 추가**

`4K_ML/requirements.txt` 끝에 추가:

```
sentence-transformers==3.3.1
```

- [ ] **Step 2: 설치** (torch 포함 — 용량 크고 수 분 소요 가능)

Run: `cd 4K_ML && .venv/bin/pip install -r requirements.txt`
Expected: sentence-transformers, torch 설치 완료

- [ ] **Step 3: 패키지 생성**

Run: `cd 4K_ML && mkdir -p subtitle_parse && touch subtitle_parse/__init__.py`

- [ ] **Step 4: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_ML/requirements.txt 4K_ML/subtitle_parse/__init__.py
git commit -m "chore(ml): subtitle_parse 패키지 + sentence-transformers 의존성"
```

---

## Task 2: `.srt` 파서 (TDD)

**Files:**
- Test: `4K_ML/tests/test_srt.py`
- Create: `4K_ML/subtitle_parse/srt.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`4K_ML/tests/test_srt.py`:

```python
from subtitle_parse.srt import parse_srt, Cue

BASIC = """1
00:00:01,000 --> 00:00:02,500
Hello there.

2
00:00:04,000 --> 00:00:06,000
General Kenobi.
"""


def test_parses_two_cues():
    cues = parse_srt(BASIC)
    assert cues == [
        Cue(index=0, start_ms=1000, end_ms=2500, text="Hello there."),
        Cue(index=1, start_ms=4000, end_ms=6000, text="General Kenobi."),
    ]


def test_joins_multiline_and_strips_tags():
    srt = "1\n00:00:01,000 --> 00:00:02,000\n<i>first</i>\nsecond\n"
    assert parse_srt(srt)[0].text == "first second"


def test_keeps_sdh_brackets():
    srt = "1\n00:00:01,000 --> 00:00:02,000\n[explosion]\n"
    assert parse_srt(srt)[0].text == "[explosion]"


def test_skips_malformed_block_and_reindexes():
    srt = ("1\n00:00:01,000 --> 00:00:02,000\nok one\n\n"
           "garbage block no timing\n\n"
           "3\n00:00:05,000 --> 00:00:06,000\nok two\n")
    cues = parse_srt(srt)
    assert [c.text for c in cues] == ["ok one", "ok two"]
    assert [c.index for c in cues] == [0, 1]


def test_skips_empty_text_cue():
    srt = "1\n00:00:01,000 --> 00:00:02,000\n\n2\n00:00:03,000 --> 00:00:04,000\nhi\n"
    assert [c.text for c in parse_srt(srt)] == ["hi"]
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd 4K_ML && .venv/bin/python -m pytest tests/test_srt.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'subtitle_parse.srt'`

- [ ] **Step 3: 구현**

`4K_ML/subtitle_parse/srt.py`:

```python
"""순수 .srt 파서 → list[Cue]. <태그> 제거, 멀티라인 합치기, SDH 대괄호 유지."""
import re
from dataclasses import dataclass

_TIME = re.compile(r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})")
_TAG = re.compile(r"<[^>]+>")


@dataclass
class Cue:
    index: int
    start_ms: int
    end_ms: int
    text: str


def _ts_to_ms(ts: str) -> int | None:
    m = _TIME.search(ts)
    if not m:
        return None
    h, mm, s, ms = (int(x) for x in m.groups())
    return ((h * 60 + mm) * 60 + s) * 1000 + ms


def parse_srt(raw_text: str) -> list[Cue]:
    cues: list[Cue] = []
    blocks = re.split(r"\r?\n\r?\n+", raw_text.strip())
    idx = 0
    for block in blocks:
        lines = [ln for ln in block.splitlines() if ln.strip() != ""]
        timing_i = next((i for i, ln in enumerate(lines) if "-->" in ln), None)
        if timing_i is None:
            continue
        parts = lines[timing_i].split("-->")
        if len(parts) != 2:
            continue
        start, end = _ts_to_ms(parts[0]), _ts_to_ms(parts[1])
        if start is None or end is None:
            continue
        text = " ".join(_TAG.sub("", t) for t in lines[timing_i + 1:]).strip()
        if not text:
            continue
        cues.append(Cue(index=idx, start_ms=start, end_ms=end, text=text))
        idx += 1
    return cues
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd 4K_ML && .venv/bin/python -m pytest tests/test_srt.py -q`
Expected: PASS (5 passed)

- [ ] **Step 5: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_ML/subtitle_parse/srt.py 4K_ML/tests/test_srt.py
git commit -m "feat(ml): .srt 파서(parse_srt) + 테스트"
```

---

## Task 3: cue 피처 (TDD)

**Files:**
- Test: `4K_ML/tests/test_features.py`
- Create: `4K_ML/subtitle_parse/features.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`4K_ML/tests/test_features.py`:

```python
from subtitle_parse.srt import Cue
from subtitle_parse.features import line_features


def test_features_basic():
    cues = [
        Cue(0, 1000, 2000, "hello world"),
        Cue(1, 5000, 6000, "[boom]"),
    ]
    f = line_features(cues)
    assert f[0]["gap_before_ms"] is None
    assert f[0]["duration_ms"] == 1000
    assert f[0]["char_count"] == len("hello world")
    assert f[0]["word_count"] == 2
    assert f[1]["gap_before_ms"] == 3000          # 5000 - 2000
    assert f[1]["word_count"] == 1
    # progress_ratio: 마지막 cue end=6000 기준, cue0 중앙=1500
    assert abs(f[0]["progress_ratio"] - (1500 / 6000)) < 1e-9


def test_empty():
    assert line_features([]) == []
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd 4K_ML && .venv/bin/python -m pytest tests/test_features.py -q`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: 구현**

`4K_ML/subtitle_parse/features.py`:

```python
"""cue별 보조 피처 (순수). 다운스트림 dialogues 컬럼과 1:1."""
from subtitle_parse.srt import Cue


def line_features(cues: list[Cue]) -> list[dict]:
    if not cues:
        return []
    total = cues[-1].end_ms or 1
    out = []
    prev_end = None
    for c in cues:
        mid = (c.start_ms + c.end_ms) / 2
        out.append({
            "start_ms": c.start_ms,
            "end_ms": c.end_ms,
            "duration_ms": c.end_ms - c.start_ms,
            "text": c.text,
            "char_count": len(c.text),
            "word_count": len(c.text.split()),
            "gap_before_ms": None if prev_end is None else max(0, c.start_ms - prev_end),
            "progress_ratio": mid / total,
        })
        prev_end = c.end_ms
    return out
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd 4K_ML && .venv/bin/python -m pytest tests/test_features.py -q`
Expected: PASS (2 passed)

- [ ] **Step 5: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_ML/subtitle_parse/features.py 4K_ML/tests/test_features.py
git commit -m "feat(ml): cue 피처(line_features) + 테스트"
```

---

## Task 4: 하이브리드 씬 분할 (TDD)

**Files:**
- Test: `4K_ML/tests/test_scenes.py`
- Create: `4K_ML/subtitle_parse/scenes.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`4K_ML/tests/test_scenes.py`:

```python
import numpy as np

from subtitle_parse.scenes import split_scenes, config_from_env

A = [1.0, 0.0]   # 유사 그룹
B = [0.0, 1.0]   # A와 cosine 0 (< 0.5 → 의미 경계)


def _feat(gap):
    return {"gap_before_ms": gap}


def test_gap_boundary():
    feats = [_feat(None), _feat(10000), _feat(0)]   # 두번째에서 큰 gap
    emb = np.array([A, A, A])
    assert split_scenes(feats, emb, gap_ms=3000, sim_threshold=0.5, min_lines=1) == [[0], [1, 2]]


def test_semantic_boundary_when_min_lines_met():
    # 0,1,2 유사 → 한 씬(min_lines=3 충족), 3은 의미 다름 → 경계
    feats = [_feat(None), _feat(0), _feat(0), _feat(0)]
    emb = np.array([A, A, A, B])
    assert split_scenes(feats, emb, gap_ms=3000, sim_threshold=0.5, min_lines=3) == [[0, 1, 2], [3]]


def test_semantic_ignored_below_min_lines():
    # 1이 의미 다르지만 현재 씬 [0] 길이 1 < min_lines=3 → 경계 무시
    feats = [_feat(None), _feat(0)]
    emb = np.array([A, B])
    assert split_scenes(feats, emb, gap_ms=3000, sim_threshold=0.5, min_lines=3) == [[0, 1]]


def test_single_scene_when_similar_and_small_gaps():
    feats = [_feat(None), _feat(0), _feat(0)]
    emb = np.array([A, A, A])
    assert split_scenes(feats, emb, gap_ms=3000, sim_threshold=0.5, min_lines=3) == [[0, 1, 2]]


def test_empty():
    assert split_scenes([], np.zeros((0, 2)), 3000, 0.5, 3) == []


def test_config_defaults(monkeypatch):
    for k in ("SCENE_GAP_MS", "SCENE_SIM_THRESHOLD", "SCENE_MIN_LINES"):
        monkeypatch.delenv(k, raising=False)
    assert config_from_env() == (3000, 0.5, 3)
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd 4K_ML && .venv/bin/python -m pytest tests/test_scenes.py -q`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: 구현**

`4K_ML/subtitle_parse/scenes.py`:

```python
"""하이브리드 씬 분할: 무발화 gap(규칙) + 문맥 유사도(의미)."""
import os

import numpy as np


def config_from_env() -> tuple[int, float, int]:
    return (
        int(os.getenv("SCENE_GAP_MS", "3000")),
        float(os.getenv("SCENE_SIM_THRESHOLD", "0.5")),
        int(os.getenv("SCENE_MIN_LINES", "3")),
    )


def split_method(gap_ms: int, sim_threshold: float) -> str:
    return f"gap{gap_ms}+sbert-minilm-sim{sim_threshold}"


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = float(np.linalg.norm(a)), float(np.linalg.norm(b))
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def split_scenes(features: list[dict], embeddings: np.ndarray,
                 gap_ms: int, sim_threshold: float, min_lines: int) -> list[list[int]]:
    """features와 embeddings(정렬됨)를 받아 cue 인덱스의 씬별 그룹 반환."""
    n = len(features)
    if n == 0:
        return []
    scenes: list[list[int]] = []
    current = [0]
    centroid_sum = embeddings[0].astype(float).copy()
    for i in range(1, n):
        gap = features[i].get("gap_before_ms") or 0
        boundary = gap > gap_ms
        if not boundary:
            centroid = centroid_sum / len(current)
            if _cosine(embeddings[i], centroid) < sim_threshold and len(current) >= min_lines:
                boundary = True
        if boundary:
            scenes.append(current)
            current = [i]
            centroid_sum = embeddings[i].astype(float).copy()
        else:
            current.append(i)
            centroid_sum += embeddings[i]
    scenes.append(current)
    return scenes
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd 4K_ML && .venv/bin/python -m pytest tests/test_scenes.py -q`
Expected: PASS (6 passed)

- [ ] **Step 5: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_ML/subtitle_parse/scenes.py 4K_ML/tests/test_scenes.py
git commit -m "feat(ml): 하이브리드 씬 분할(split_scenes) + 테스트"
```

---

## Task 5: 임베딩 모듈 (lazy, 유닛 테스트 없음)

**Files:**
- Create: `4K_ML/subtitle_parse/embed.py`

- [ ] **Step 1: 구현**

`4K_ML/subtitle_parse/embed.py`:

```python
"""all-MiniLM-L6-v2 임베딩. 모델은 최초 호출 시 lazy 로드(테스트에선 호출 안 함)."""
import numpy as np

_MODEL = None


def _get_model():
    global _MODEL
    if _MODEL is None:
        from sentence_transformers import SentenceTransformer
        _MODEL = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
    return _MODEL


def embed_texts(texts: list[str]) -> np.ndarray:
    if not texts:
        return np.zeros((0, 384))
    return _get_model().encode(texts, batch_size=64, show_progress_bar=False,
                               convert_to_numpy=True)
```

- [ ] **Step 2: import 동작 확인** (모델 로드 안 함)

Run: `cd 4K_ML && .venv/bin/python -c "from subtitle_parse import embed; print('ok')"`
Expected: `ok`

- [ ] **Step 3: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_ML/subtitle_parse/embed.py
git commit -m "feat(ml): all-MiniLM 임베딩 모듈(embed_texts, lazy)"
```

---

## Task 6: vm5 REST 입출력 (TDD)

**Files:**
- Test: `4K_ML/tests/test_parse_db.py`
- Create: `4K_ML/subtitle_parse/db.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`4K_ML/tests/test_parse_db.py`:

```python
import httpx

from subtitle_parse import db


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def _env(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "https://ai.test")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")


def test_fetch_targets_filters(monkeypatch):
    _env(monkeypatch)

    def handler(req):
        return httpx.Response(200, json=[
            {"tmdb_id": 1, "subtitle_state": "done", "parse_state": "pending"},
            {"tmdb_id": 2, "subtitle_state": "done", "parse_state": "done"},
            {"tmdb_id": 3, "subtitle_state": "pending", "parse_state": "pending"},
        ])

    assert db.fetch_targets(_client(handler)) == [1]


def test_upsert_scenes_returns_rows(monkeypatch):
    _env(monkeypatch)
    seen = {}

    def handler(req):
        import json
        seen["url"] = str(req.url)
        seen["prefer"] = req.headers.get("prefer", "")
        return httpx.Response(201, json=[{"id": 10, "scene_index": 0}])

    out = db.upsert_scenes(_client(handler), [{"subtitles_id": 1, "scene_index": 0}])
    assert out[0]["id"] == 10
    assert "on_conflict=subtitles_id%2Cscene_index" in seen["url"] or "on_conflict=subtitles_id,scene_index" in seen["url"]
    assert "return=representation" in seen["prefer"]


def test_set_parse_state_posts(monkeypatch):
    _env(monkeypatch)
    seen = {}

    def handler(req):
        import json
        seen["body"] = json.loads(req.content)
        return httpx.Response(201, json=[])

    db.set_parse_state(_client(handler), 7, "done")
    assert seen["body"][0]["tmdb_id"] == 7
    assert seen["body"][0]["parse_state"] == "done"
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd 4K_ML && .venv/bin/python -m pytest tests/test_parse_db.py -q`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: 구현**

`4K_ML/subtitle_parse/db.py`:

```python
"""vm5 REST 입출력 (sync httpx). public 스키마, apikey 인증, 선택 basic auth."""
import os
from datetime import datetime, timezone

import httpx


def _ai() -> tuple[str, str]:
    return os.getenv("AI_DATABASE_URL", ""), os.getenv("AI_DATABASE_KEY", "")


def _auth():
    user = os.getenv("AI_BASIC_USER")
    return (user, os.getenv("AI_BASIC_PASS", "")) if user else None


def _headers(write: bool = False, representation: bool = False) -> dict:
    _, key = _ai()
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    if write:
        h["Content-Type"] = "application/json"
        ret = "return=representation" if representation else "return=minimal"
        h["Prefer"] = f"resolution=merge-duplicates,{ret}"
    return h


def fetch_targets(client: httpx.Client) -> list[int]:
    """subtitle_state='done' & parse_state!='done'인 tmdb_id 목록."""
    url, _ = _ai()
    r = client.get(f"{url}/rest/v1/processing_status",
                   params={"select": "tmdb_id,subtitle_state,parse_state", "limit": "1000000"},
                   headers=_headers(), auth=_auth(), timeout=30)
    r.raise_for_status()
    return [row["tmdb_id"] for row in r.json()
            if row.get("subtitle_state") == "done" and row.get("parse_state") != "done"]


def fetch_subtitle(client: httpx.Client, tmdb_id: int) -> dict | None:
    url, _ = _ai()
    r = client.get(f"{url}/rest/v1/subtitles",
                   params={"select": "id,tmdb_id,raw_text", "tmdb_id": f"eq.{tmdb_id}", "limit": "1"},
                   headers=_headers(), auth=_auth(), timeout=30)
    r.raise_for_status()
    rows = r.json()
    return rows[0] if rows else None


def upsert_scenes(client: httpx.Client, rows: list[dict]) -> list[dict]:
    url, _ = _ai()
    r = client.post(f"{url}/rest/v1/scenes", params={"on_conflict": "subtitles_id,scene_index"},
                    json=rows, headers=_headers(write=True, representation=True),
                    auth=_auth(), timeout=60)
    if r.status_code not in (200, 201):
        raise RuntimeError(f"scenes upsert 실패 {r.status_code}: {r.text[:200]}")
    return r.json()


def upsert_dialogues(client: httpx.Client, rows: list[dict]) -> None:
    url, _ = _ai()
    r = client.post(f"{url}/rest/v1/dialogues", params={"on_conflict": "subtitles_id,line_index"},
                    json=rows, headers=_headers(write=True), auth=_auth(), timeout=60)
    if r.status_code not in (200, 201, 204):
        raise RuntimeError(f"dialogues upsert 실패 {r.status_code}: {r.text[:200]}")


def set_parse_state(client: httpx.Client, tmdb_id: int, state: str, error: str | None = None) -> None:
    url, _ = _ai()
    row = {"tmdb_id": tmdb_id, "parse_state": state, "error": error,
           "updated_at": datetime.now(timezone.utc).isoformat()}
    r = client.post(f"{url}/rest/v1/processing_status", params={"on_conflict": "tmdb_id"},
                    json=[row], headers=_headers(write=True), auth=_auth(), timeout=30)
    if r.status_code not in (200, 201, 204):
        raise RuntimeError(f"parse_state upsert 실패 {r.status_code}: {r.text[:200]}")
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd 4K_ML && .venv/bin/python -m pytest tests/test_parse_db.py -q`
Expected: PASS (3 passed)

- [ ] **Step 5: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_ML/subtitle_parse/db.py 4K_ML/tests/test_parse_db.py
git commit -m "feat(ml): 파싱 vm5 REST 입출력(db) + 테스트"
```

---

## Task 7: 배치 메인 `parse_subtitles.py` (TDD)

**Files:**
- Test: `4K_ML/tests/test_parse_main.py`
- Create: `4K_ML/subtitle_parse/parse_subtitles.py`

- [ ] **Step 1: 실패하는 테스트 작성** (`parse_one`: srt→씬→DB 행 생성 검증, 임베딩·DB 모킹)

`4K_ML/tests/test_parse_main.py`:

```python
import numpy as np

from subtitle_parse import parse_subtitles as main

SRT = (
    "1\n00:00:01,000 --> 00:00:02,000\nalpha\n\n"
    "2\n00:00:02,200 --> 00:00:03,000\nbeta\n\n"
    "3\n00:00:03,200 --> 00:00:04,000\ngamma\n\n"
    "4\n00:00:20,000 --> 00:00:21,000\ndelta\n"   # 큰 gap → 새 씬
)


def test_parse_one_builds_scenes_and_dialogues(monkeypatch):
    # 임베딩은 모두 동일 → 의미 경계 없음. gap(16s)만 경계 → 씬 2개([0,1,2],[3])
    monkeypatch.setattr(main, "embed_texts", lambda texts: np.ones((len(texts), 2)))

    posted = {"scenes": None, "dialogues": None}

    def fake_upsert_scenes(client, rows):
        posted["scenes"] = rows
        return [{"id": 100 + r["scene_index"], "scene_index": r["scene_index"]} for r in rows]

    def fake_upsert_dialogues(client, rows):
        posted["dialogues"] = rows

    monkeypatch.setattr(main.db, "upsert_scenes", fake_upsert_scenes)
    monkeypatch.setattr(main.db, "upsert_dialogues", fake_upsert_dialogues)

    n = main.parse_one(None, {"id": 7, "tmdb_id": 7, "raw_text": SRT},
                       gap_ms=3000, sim_threshold=0.5, min_lines=3)

    assert n == 2
    assert [s["scene_index"] for s in posted["scenes"]] == [0, 1]
    assert posted["scenes"][0]["dialogue_count"] == 3
    assert posted["scenes"][1]["dialogue_count"] == 1
    # dialogues: line_index 0..3, scenes_id 매핑(앞 3개=100, 마지막=101)
    assert [d["line_index"] for d in posted["dialogues"]] == [0, 1, 2, 3]
    assert posted["dialogues"][0]["scenes_id"] == 100
    assert posted["dialogues"][3]["scenes_id"] == 101
    assert posted["dialogues"][0]["subtitles_id"] == 7


def test_parse_one_raises_on_empty(monkeypatch):
    monkeypatch.setattr(main, "embed_texts", lambda texts: np.ones((len(texts), 2)))
    import pytest
    with pytest.raises(ValueError):
        main.parse_one(None, {"id": 1, "tmdb_id": 1, "raw_text": "garbage"},
                       gap_ms=3000, sim_threshold=0.5, min_lines=3)
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd 4K_ML && .venv/bin/python -m pytest tests/test_parse_main.py -q`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: 구현**

`4K_ML/subtitle_parse/parse_subtitles.py`:

```python
#!/usr/bin/env python3
"""자막 파싱 배치 — vm5 subtitles → dialogues/scenes.

env: AI_DATABASE_URL, AI_DATABASE_KEY (선택 AI_BASIC_*), SCENE_* (선택)
"""
import httpx

from subtitle_parse import db
from subtitle_parse.srt import parse_srt
from subtitle_parse.features import line_features
from subtitle_parse.scenes import split_scenes, split_method, config_from_env
from subtitle_parse.embed import embed_texts


def parse_one(client, sub: dict, gap_ms: int, sim_threshold: float, min_lines: int) -> int:
    """자막 1편을 파싱해 scenes/dialogues upsert. 반환: 씬 개수."""
    cues = parse_srt(sub["raw_text"])
    if not cues:
        raise ValueError("파싱된 cue 없음")
    feats = line_features(cues)
    emb = embed_texts([c.text for c in cues])
    groups = split_scenes(feats, emb, gap_ms, sim_threshold, min_lines)

    total = feats[-1]["end_ms"] or 1
    method = split_method(gap_ms, sim_threshold)
    scene_rows = []
    for si, g in enumerate(groups):
        first, last = feats[g[0]], feats[g[-1]]
        mid = (first["start_ms"] + last["end_ms"]) / 2
        scene_rows.append({
            "subtitles_id": sub["id"], "scene_index": si,
            "start_ms": first["start_ms"], "end_ms": last["end_ms"],
            "progress_ratio": mid / total,
            "text": " ".join(feats[i]["text"] for i in g),
            "dialogue_count": len(g), "split_method": method,
        })
    saved = db.upsert_scenes(client, scene_rows)
    sid_by_index = {row["scene_index"]: row["id"] for row in saved}

    dialogue_rows = []
    for si, g in enumerate(groups):
        for li in g:
            f = feats[li]
            dialogue_rows.append({
                "subtitles_id": sub["id"], "scenes_id": sid_by_index[si],
                "line_index": li, "start_ms": f["start_ms"], "end_ms": f["end_ms"],
                "duration_ms": f["duration_ms"], "text": f["text"],
                "char_count": f["char_count"], "word_count": f["word_count"],
                "gap_before_ms": f["gap_before_ms"], "progress_ratio": f["progress_ratio"],
            })
    db.upsert_dialogues(client, dialogue_rows)
    return len(groups)


def run() -> None:
    import os
    if not os.getenv("AI_DATABASE_URL"):
        raise SystemExit("AI_DATABASE_URL 환경변수가 필요합니다 (vm5).")
    gap_ms, sim_threshold, min_lines = config_from_env()
    counts = {"done": 0, "failed": 0}
    with httpx.Client(timeout=60, verify=False) as client:
        targets = db.fetch_targets(client)
        for n, tmdb_id in enumerate(targets, 1):
            sub = db.fetch_subtitle(client, tmdb_id)
            if not sub:
                continue
            try:
                k = parse_one(client, sub, gap_ms, sim_threshold, min_lines)
                db.set_parse_state(client, tmdb_id, "done")
                counts["done"] += 1
                print(f"[{n}/{len(targets)}] tmdb={tmdb_id} scenes={k}")
            except Exception as e:  # noqa: BLE001
                db.set_parse_state(client, tmdb_id, "failed", str(e)[:500])
                counts["failed"] += 1
                print(f"[{n}/{len(targets)}] tmdb={tmdb_id} FAILED: {e}")
    print(f"완료: {counts}")


if __name__ == "__main__":
    run()
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd 4K_ML && .venv/bin/python -m pytest tests/test_parse_main.py -q`
Expected: PASS (2 passed)

- [ ] **Step 5: 전체 테스트 회귀**

Run: `cd 4K_ML && .venv/bin/python -m pytest -q`
Expected: 전부 PASS (스키마 테스트는 PG 없으면 skip)

- [ ] **Step 6: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_ML/subtitle_parse/parse_subtitles.py 4K_ML/tests/test_parse_main.py
git commit -m "feat(ml): 자막 파싱 배치 메인(parse_subtitles) + 테스트"
```

---

## Task 8: 라이브 실행 검증 (운영 핸드오프)

**Files:** (없음 — 실행/검증)

- [ ] **Step 1: env 준비** (`4K_ML/.env`에 이미 있음)

`AI_DATABASE_URL=https://ai.peakly.art`, `AI_DATABASE_KEY=<ai service_role>`. (자막 수집으로 vm5에 `subtitle_state='done'`인 영화가 있어야 대상이 생김.)

- [ ] **Step 2: 시범 실행**

```bash
cd 4K_ML && set -a; source .env; set +a
.venv/bin/python -m subtitle_parse.parse_subtitles
```
Expected: `[1/N] tmdb=... scenes=..` 로그 후 `완료: {'done': N, 'failed': M}`. (최초 실행 시 all-MiniLM 모델 다운로드 발생.)

- [ ] **Step 3: vm5 적재 확인**

```bash
curl -s "https://ai.peakly.art/rest/v1/scenes?select=subtitles_id,scene_index,dialogue_count,progress_ratio&limit=10" -H "apikey: $AI_DATABASE_KEY"
curl -s "https://ai.peakly.art/rest/v1/dialogues?select=subtitles_id,line_index,word_count,gap_before_ms&limit=10" -H "apikey: $AI_DATABASE_KEY"
curl -s "https://ai.peakly.art/rest/v1/processing_status?select=parse_state" -H "apikey: $AI_DATABASE_KEY"
```
Expected: scenes/dialogues 행 생성, parse_state='done' 분포. 영화당 씬 개수가 40~70 부근인지 확인(아니면 `SCENE_GAP_MS`/`SCENE_SIM_THRESHOLD` 튜닝).

---

## Self-Review 메모

- **Spec 커버리지:** srt 파서(T2) / 피처(T3) / 하이브리드 분할 gap·의미·min_lines(T4) / 임베딩 all-MiniLM lazy(T5) / vm5 IO·대상필터·upsert·parse_state(T6) / 배치 메인 done·failed·멱등 스킵은 fetch_targets가 parse_state!=done만 반환(T6,T7) / 실측(T8). SDH 대괄호 유지(T2 test), 중간 세밀도 기본값(T4 config).
- **타입/이름 일관성:** `Cue`/`parse_srt`(srt), `line_features`(features), `split_scenes`/`config_from_env`/`split_method`(scenes), `embed_texts`(embed), `fetch_targets`/`fetch_subtitle`/`upsert_scenes`/`upsert_dialogues`/`set_parse_state`(db), `parse_one`/`run`(main) — 테스트·구현·본문 일치. dialogues/scenes 컬럼명이 schema.sql과 일치(subtitles_id, scenes_id, line_index, scene_index, dialogue_count, split_method 등).
- **Placeholder:** 없음.
- **주의:** 멱등은 "parse_state!=done만 대상"(fetch_targets) + upsert(on_conflict)로 failed 재시도 안전. 실제 vm5/모델 검증은 T8. sentence-transformers 설치는 용량 큼.
