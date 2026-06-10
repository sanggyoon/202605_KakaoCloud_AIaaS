# LLM 라벨링 (Valence + Arousal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** vm5의 씬에 Claude Sonnet 4.6(Batch API)으로 Valence·Arousal 점수를 매겨 `scene_scores`에 적재하는 멱등 배치(`4K_ML/labeling/`)를 만든다.

**Architecture:** 영화 1편=배치 요청 1개로 전체 씬을 한 콜에 보내고, structured outputs로 씬당 `{scene_index, arousal, valence}`를 받아 0~1 clamp 후 축별 `model_version` 행으로 upsert. 모든 vm5 접근은 Supabase REST(httpx), Anthropic은 공식 SDK. Argo WorkflowTemplate(GPU 불필요)로 실행.

**Tech Stack:** Python 3.11, httpx(동기), anthropic SDK, pytest, Docker, Argo Workflows.

**Spec:** `docs/superpowers/specs/2026-06-10-llm-labeling-va-design.md`

**Working dir:** 모든 `pytest`/`python`은 `4K_ML/`에서 실행. git 명령은 **저장소 루트**에서. 현재 브랜치 `feat/d-llm-labeling-va`.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `4K_ML/labeling/__init__.py` | 패키지 마커 |
| `4K_ML/labeling/prompt.py` | RUBRIC(시스템), `build_user_message`, `OUTPUT_SCHEMA` |
| `4K_ML/labeling/db.py` | vm5 REST: 대상조회·씬조회·model_versions 보장·scene_scores upsert·label_state, 버전 상수 |
| `4K_ML/labeling/batch.py` | Anthropic Batch: `build_requests`/`submit`/`poll`/`collect`, 모델 상수 |
| `4K_ML/labeling/label_scenes.py` | `run()` 오케스트레이션 + `parse_to_rows`/`_clamp` |
| `4K_ML/tests/test_label_prompt.py` | prompt 단위 테스트 |
| `4K_ML/tests/test_label_db.py` | db 단위 테스트(MockTransport) |
| `4K_ML/tests/test_label_batch.py` | batch 단위 테스트(fake client) |
| `4K_ML/tests/test_label_main.py` | run/parse_to_rows 테스트(monkeypatch) |
| `4K_ML/requirements.txt` | `anthropic` 추가 |
| `4K_ML/Dockerfile` | `COPY labeling/` 추가 |
| `Ansible/manifests/4k-ml/workflowtemplate-llm-labeling.yaml` | 신규 WorkflowTemplate(GPU 없음) |
| `Ansible/manifests/test/llm-labeling-run.yaml` | 1회 실행용 Workflow |
| `.github/workflows/deploy-4k-ml.yml` | 새 WT 이미지 태그 bump |

---

## Task 1: 패키지 스캐폴드 + anthropic 의존성

**Files:**
- Create: `4K_ML/labeling/__init__.py`
- Modify: `4K_ML/requirements.txt`

- [ ] **Step 1: 패키지 마커 생성**

`4K_ML/labeling/__init__.py` — 빈 파일:

```python
```

- [ ] **Step 2: requirements에 anthropic 추가**

`4K_ML/requirements.txt` 마지막 줄(`sentence-transformers==3.3.1`) 다음에 추가:

```
anthropic
```

- [ ] **Step 3: 설치하고 버전 확인 후 핀 고정**

Run (4K_ML/에서):
```bash
pip install anthropic
python -c "import anthropic; print(anthropic.__version__)"
```
Expected: 버전 번호 출력(예: `0.69.0`). 출력된 버전으로 `requirements.txt`의 `anthropic`을 `anthropic==<버전>`으로 고정.

- [ ] **Step 4: batches/structured outputs 심볼 존재 확인**

Run:
```bash
python -c "from anthropic.types.message_create_params import MessageCreateParamsNonStreaming; from anthropic.types.messages.batch_create_params import Request; print('ok')"
```
Expected: `ok`. (실패 시 더 최신 버전으로 업그레이드 후 재핀.)

- [ ] **Step 5: Commit**

```bash
git add 4K_ML/labeling/__init__.py 4K_ML/requirements.txt
git commit -m "build: labeling 패키지 스캐폴드 + anthropic 의존성"
```

---

## Task 2: prompt.py — 루브릭·메시지·출력 스키마

**Files:**
- Create: `4K_ML/labeling/prompt.py`
- Test: `4K_ML/tests/test_label_prompt.py`

- [ ] **Step 1: 실패 테스트 작성**

`4K_ML/tests/test_label_prompt.py`:

```python
from labeling.prompt import RUBRIC, OUTPUT_SCHEMA, build_user_message


def test_user_message_includes_indexed_scenes():
    scenes = [
        {"scenes_id": 10, "scene_index": 0, "text": "alpha beta"},
        {"scenes_id": 11, "scene_index": 1, "text": "gamma"},
    ]
    msg = build_user_message(scenes)
    assert "[0]" in msg and "alpha beta" in msg
    assert "[1]" in msg and "gamma" in msg


def test_rubric_mentions_both_axes():
    assert "Arousal" in RUBRIC and "Valence" in RUBRIC


def test_output_schema_has_only_two_axes():
    item = OUTPUT_SCHEMA["properties"]["scenes"]["items"]
    assert set(item["required"]) == {"scene_index", "arousal", "valence"}
    assert "reason" not in item["properties"]
    assert item["additionalProperties"] is False
```

- [ ] **Step 2: 실패 확인**

Run: `pytest tests/test_label_prompt.py -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'labeling.prompt'`)

- [ ] **Step 3: 구현**

`4K_ML/labeling/prompt.py`:

```python
"""Sonnet 라벨링용 루브릭·메시지·출력 스키마 (Valence + Arousal, 0~1 절대 앵커)."""

RUBRIC = """You score movie scenes on two emotional axes, each 0.0-1.0, using ABSOLUTE anchors.
You see the entire movie's scenes at once; use the whole-movie context to order scenes
relatively, but keep the anchors absolute (a calm movie should score low overall).

Arousal (intensity / excitement / tension):
  0.0 static or calm (background, mundane dialogue, transitions)
  0.3 mild stirring (seeds of conflict)
  0.6 elevated (confrontation, danger, chase)
  0.9-1.0 peak (climax, maximum action or clash)

Valence (emotional positivity / negativity):
  0.0 very negative (fear, tragedy, despair, death)
  0.5 neutral (factual, ordinary conversation)
  1.0 very positive (joy, triumph, love, reconciliation)

Return a score for EVERY scene by its scene_index. Output only the two numbers per scene.
"""

OUTPUT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["scenes"],
    "properties": {
        "scenes": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["scene_index", "arousal", "valence"],
                "properties": {
                    "scene_index": {"type": "integer"},
                    "arousal": {"type": "number"},
                    "valence": {"type": "number"},
                },
            },
        }
    },
}


def build_user_message(scenes: list[dict]) -> str:
    """씬 목록을 '[scene_index] text' 줄로 직렬화."""
    lines = [f"[{s['scene_index']}] {s['text']}" for s in scenes]
    return "Score every scene below.\n\n" + "\n".join(lines)
```

- [ ] **Step 4: 통과 확인**

Run: `pytest tests/test_label_prompt.py -v`
Expected: PASS (3개)

- [ ] **Step 5: Commit**

```bash
git add 4K_ML/labeling/prompt.py 4K_ML/tests/test_label_prompt.py
git commit -m "feat: 라벨링 루브릭·user 메시지·출력 스키마(VA)"
```

---

## Task 3: db.py — vm5 REST 입출력

**Files:**
- Create: `4K_ML/labeling/db.py`
- Test: `4K_ML/tests/test_label_db.py`

- [ ] **Step 1: 실패 테스트 작성**

`4K_ML/tests/test_label_db.py`:

```python
import json

import httpx

from labeling import db


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def _env(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "https://ai.test")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")


def test_fetch_label_targets_filters(monkeypatch):
    _env(monkeypatch)

    def handler(req):
        return httpx.Response(200, json=[
            {"tmdb_id": 1, "parse_state": "done", "label_state": "pending"},
            {"tmdb_id": 2, "parse_state": "done", "label_state": "done"},
            {"tmdb_id": 3, "parse_state": "pending", "label_state": "pending"},
        ])

    assert db.fetch_label_targets(_client(handler)) == [1]


def test_fetch_scenes_two_calls(monkeypatch):
    _env(monkeypatch)

    def handler(req):
        if "subtitles" in req.url.path:
            return httpx.Response(200, json=[{"id": 55}])
        assert "subtitles_id=eq.55" in str(req.url)
        assert "order=scene_index" in str(req.url)
        return httpx.Response(200, json=[
            {"id": 100, "scene_index": 0, "text": "a"},
            {"id": 101, "scene_index": 1, "text": "b"},
        ])

    out = db.fetch_scenes(_client(handler), 7)
    assert out == [
        {"scenes_id": 100, "scene_index": 0, "text": "a"},
        {"scenes_id": 101, "scene_index": 1, "text": "b"},
    ]


def test_fetch_scenes_no_subtitle(monkeypatch):
    _env(monkeypatch)
    assert db.fetch_scenes(_client(lambda req: httpx.Response(200, json=[])), 9) == []


def test_ensure_model_versions_payload(monkeypatch):
    _env(monkeypatch)
    seen = {}

    def handler(req):
        seen["url"] = str(req.url)
        seen["body"] = json.loads(req.content)
        return httpx.Response(201, json=[])

    db.ensure_model_versions(_client(handler))
    versions = {r["model_version"] for r in seen["body"]}
    assert versions == {db.AROUSAL_MV, db.VALENCE_MV}
    assert "on_conflict=model_version" in seen["url"]


def test_upsert_scene_scores_conflict(monkeypatch):
    _env(monkeypatch)
    seen = {}

    def handler(req):
        seen["url"] = str(req.url)
        return httpx.Response(201, json=[])

    db.upsert_scene_scores(_client(handler), [
        {"scenes_id": 1, "score": 0.5, "model_version": db.AROUSAL_MV},
    ])
    assert "on_conflict=scenes_id" in seen["url"] and "model_version" in seen["url"]


def test_set_label_state_posts(monkeypatch):
    _env(monkeypatch)
    seen = {}

    def handler(req):
        seen["body"] = json.loads(req.content)
        return httpx.Response(201, json=[])

    db.set_label_state(_client(handler), 7, "done")
    assert seen["body"][0]["tmdb_id"] == 7
    assert seen["body"][0]["label_state"] == "done"
```

- [ ] **Step 2: 실패 확인**

Run: `pytest tests/test_label_db.py -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'labeling.db'`)

- [ ] **Step 3: 구현**

`4K_ML/labeling/db.py`:

```python
"""vm5 REST 입출력 (sync httpx). public 스키마, apikey 인증, 선택 basic auth."""
import os
from datetime import datetime, timezone

import httpx

VERSION_TAG = "llm-va-v1"
AROUSAL_MV = f"{VERSION_TAG}::arousal"
VALENCE_MV = f"{VERSION_TAG}::valence"


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


def fetch_label_targets(client: httpx.Client) -> list[int]:
    """parse_state='done' & label_state!='done'인 tmdb_id 목록."""
    url, _ = _ai()
    r = client.get(f"{url}/rest/v1/processing_status",
                   params={"select": "tmdb_id,parse_state,label_state", "limit": "1000000"},
                   headers=_headers(), auth=_auth(), timeout=30)
    r.raise_for_status()
    return [row["tmdb_id"] for row in r.json()
            if row.get("parse_state") == "done" and row.get("label_state") != "done"]


def fetch_scenes(client: httpx.Client, tmdb_id: int) -> list[dict]:
    """영화의 씬을 scene_index 순으로: [{scenes_id, scene_index, text}]."""
    url, _ = _ai()
    r = client.get(f"{url}/rest/v1/subtitles",
                   params={"select": "id", "tmdb_id": f"eq.{tmdb_id}", "limit": "1"},
                   headers=_headers(), auth=_auth(), timeout=30)
    r.raise_for_status()
    rows = r.json()
    if not rows:
        return []
    sid = rows[0]["id"]
    r = client.get(f"{url}/rest/v1/scenes",
                   params={"select": "id,scene_index,text", "subtitles_id": f"eq.{sid}",
                           "order": "scene_index", "limit": "100000"},
                   headers=_headers(), auth=_auth(), timeout=30)
    r.raise_for_status()
    return [{"scenes_id": row["id"], "scene_index": row["scene_index"], "text": row["text"]}
            for row in r.json()]


def ensure_model_versions(client: httpx.Client) -> None:
    url, _ = _ai()
    rows = [
        {"model_version": AROUSAL_MV, "kind": "llm-label",
         "description": "Sonnet 4.6 arousal label, 0-1 absolute anchors"},
        {"model_version": VALENCE_MV, "kind": "llm-label",
         "description": "Sonnet 4.6 valence label, 0-1 absolute anchors"},
    ]
    r = client.post(f"{url}/rest/v1/model_versions", params={"on_conflict": "model_version"},
                    json=rows, headers=_headers(write=True), auth=_auth(), timeout=30)
    if r.status_code not in (200, 201, 204):
        raise RuntimeError(f"model_versions upsert 실패 {r.status_code}: {r.text[:200]}")


def upsert_scene_scores(client: httpx.Client, rows: list[dict]) -> None:
    url, _ = _ai()
    r = client.post(f"{url}/rest/v1/scene_scores", params={"on_conflict": "scenes_id,model_version"},
                    json=rows, headers=_headers(write=True), auth=_auth(), timeout=60)
    if r.status_code not in (200, 201, 204):
        raise RuntimeError(f"scene_scores upsert 실패 {r.status_code}: {r.text[:200]}")


def set_label_state(client: httpx.Client, tmdb_id: int, state: str, error: str | None = None) -> None:
    url, _ = _ai()
    row = {"tmdb_id": tmdb_id, "label_state": state, "error": error,
           "updated_at": datetime.now(timezone.utc).isoformat()}
    r = client.post(f"{url}/rest/v1/processing_status", params={"on_conflict": "tmdb_id"},
                    json=[row], headers=_headers(write=True), auth=_auth(), timeout=30)
    if r.status_code not in (200, 201, 204):
        raise RuntimeError(f"label_state upsert 실패 {r.status_code}: {r.text[:200]}")
```

- [ ] **Step 4: 통과 확인**

Run: `pytest tests/test_label_db.py -v`
Expected: PASS (6개)

- [ ] **Step 5: Commit**

```bash
git add 4K_ML/labeling/db.py 4K_ML/tests/test_label_db.py
git commit -m "feat: 라벨링 vm5 REST db 입출력 + 버전 상수"
```

---

## Task 4: batch.py — Anthropic Batch API 래퍼

**Files:**
- Create: `4K_ML/labeling/batch.py`
- Test: `4K_ML/tests/test_label_batch.py`

- [ ] **Step 1: 실패 테스트 작성**

`4K_ML/tests/test_label_batch.py`:

```python
import types

from labeling import batch


def test_build_requests_one_per_movie():
    movies = [
        (7, [{"scenes_id": 1, "scene_index": 0, "text": "a"}]),
        (8, [{"scenes_id": 2, "scene_index": 0, "text": "b"}]),
    ]
    reqs = batch.build_requests(movies)
    assert [r["custom_id"] for r in reqs] == ["7", "8"]
    p = reqs[0]["params"]
    assert p["model"] == "claude-sonnet-4-6"
    assert p["thinking"]["type"] == "disabled"
    assert p["output_config"]["format"]["type"] == "json_schema"
    assert "scenes" in p["output_config"]["format"]["schema"]["properties"]


def test_submit_returns_id_and_prints(capsys):
    captured = {}

    class Batches:
        def create(self, requests):
            captured["n"] = len(requests)
            return types.SimpleNamespace(id="batch_abc")

    client = types.SimpleNamespace(messages=types.SimpleNamespace(batches=Batches()))
    assert batch.submit(client, [{"custom_id": "1", "params": {}}]) == "batch_abc"
    assert captured["n"] == 1
    assert "batch_abc" in capsys.readouterr().out


def test_poll_until_ended(monkeypatch):
    monkeypatch.setattr(batch.time, "sleep", lambda s: None)
    calls = {"n": 0}

    class Batches:
        def retrieve(self, bid):
            calls["n"] += 1
            status = "in_progress" if calls["n"] < 2 else "ended"
            return types.SimpleNamespace(processing_status=status)

    client = types.SimpleNamespace(messages=types.SimpleNamespace(batches=Batches()))
    batch.poll(client, "batch_abc", interval=0)
    assert calls["n"] == 2


def _result(custom_id, rtype, text=None):
    if rtype == "succeeded":
        msg = types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=text)])
        res = types.SimpleNamespace(type="succeeded", message=msg)
    else:
        res = types.SimpleNamespace(type=rtype)
    return types.SimpleNamespace(custom_id=custom_id, result=res)


def test_collect_parses_and_flags():
    results = [
        _result("7", "succeeded", '{"scenes":[{"scene_index":0,"arousal":0.8,"valence":0.2}]}'),
        _result("8", "errored"),
        _result("9", "succeeded", "not-json"),
    ]

    class Batches:
        def results(self, bid):
            return iter(results)

    client = types.SimpleNamespace(messages=types.SimpleNamespace(batches=Batches()))
    out = list(batch.collect(client, "batch_abc"))
    assert out[0] == (7, {"scenes": [{"scene_index": 0, "arousal": 0.8, "valence": 0.2}]}, None)
    assert out[1][0] == 8 and out[1][1] is None and "errored" in out[1][2]
    assert out[2][0] == 9 and out[2][1] is None and "parse" in out[2][2].lower()
```

- [ ] **Step 2: 실패 확인**

Run: `pytest tests/test_label_batch.py -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'labeling.batch'`)

- [ ] **Step 3: 구현**

`4K_ML/labeling/batch.py`:

```python
"""Anthropic Batch API 래퍼 — 영화별 요청 빌드/제출/폴링/결과수집."""
import json
import time

from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
from anthropic.types.messages.batch_create_params import Request

from labeling.prompt import RUBRIC, OUTPUT_SCHEMA, build_user_message

MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 8000


def build_requests(movies: list[tuple[int, list[dict]]]) -> list[Request]:
    """[(tmdb_id, scenes)] → 영화당 Batch Request 1개."""
    reqs: list[Request] = []
    for tmdb_id, scenes in movies:
        reqs.append(Request(
            custom_id=str(tmdb_id),
            params=MessageCreateParamsNonStreaming(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                thinking={"type": "disabled"},
                system=[{"type": "text", "text": RUBRIC,
                         "cache_control": {"type": "ephemeral"}}],
                output_config={"format": {"type": "json_schema", "schema": OUTPUT_SCHEMA}},
                messages=[{"role": "user", "content": build_user_message(scenes)}],
            ),
        ))
    return reqs


def submit(client, requests) -> str:
    batch = client.messages.batches.create(requests=requests)
    print(f"[batch] submitted id={batch.id} count={len(requests)}")
    return batch.id


def poll(client, batch_id: str, interval: int = 60) -> None:
    while True:
        b = client.messages.batches.retrieve(batch_id)
        if b.processing_status == "ended":
            return
        time.sleep(interval)


def collect(client, batch_id: str):
    """결과 스트림 → (tmdb_id, parsed|None, error|None)."""
    for result in client.messages.batches.results(batch_id):
        tmdb_id = int(result.custom_id)
        if result.result.type == "succeeded":
            try:
                text = next(b.text for b in result.result.message.content if b.type == "text")
                yield tmdb_id, json.loads(text), None
            except (StopIteration, json.JSONDecodeError) as e:
                yield tmdb_id, None, f"parse error: {e}"
        else:
            yield tmdb_id, None, f"batch result {result.result.type}"
```

- [ ] **Step 4: 통과 확인**

Run: `pytest tests/test_label_batch.py -v`
Expected: PASS (4개)

- [ ] **Step 5: Commit**

```bash
git add 4K_ML/labeling/batch.py 4K_ML/tests/test_label_batch.py
git commit -m "feat: Anthropic Batch API 래퍼(빌드/제출/폴링/수집)"
```

---

## Task 5: label_scenes.py — 오케스트레이션

**Files:**
- Create: `4K_ML/labeling/label_scenes.py`
- Test: `4K_ML/tests/test_label_main.py`

- [ ] **Step 1: 실패 테스트 작성**

`4K_ML/tests/test_label_main.py`:

```python
from labeling import label_scenes as main
from labeling import db


def test_clamp():
    assert main._clamp(1.5) == 1.0
    assert main._clamp(-0.2) == 0.0
    assert main._clamp(0.3) == 0.3


def test_parse_to_rows_makes_two_rows_per_scene():
    parsed = {"scenes": [
        {"scene_index": 0, "arousal": 0.9, "valence": 0.1},
        {"scene_index": 1, "arousal": 1.2, "valence": 0.5},  # arousal clamp
        {"scene_index": 9, "arousal": 0.5, "valence": 0.5},  # 매핑 없음 → 스킵
    ]}
    index_to_sid = {0: 100, 1: 101}
    rows = main.parse_to_rows(parsed, index_to_sid)
    assert rows == [
        {"scenes_id": 100, "score": 0.9, "model_version": db.AROUSAL_MV},
        {"scenes_id": 100, "score": 0.1, "model_version": db.VALENCE_MV},
        {"scenes_id": 101, "score": 1.0, "model_version": db.AROUSAL_MV},
        {"scenes_id": 101, "score": 0.5, "model_version": db.VALENCE_MV},
    ]


def test_run_writes_scores_and_states(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "https://ai.test")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    monkeypatch.setattr(main, "Anthropic", lambda: object())

    monkeypatch.setattr(main.db, "ensure_model_versions", lambda c: None)
    monkeypatch.setattr(main.db, "fetch_label_targets", lambda c: [7, 8])
    scenes_by = {
        7: [{"scenes_id": 100, "scene_index": 0, "text": "a"}],
        8: [],  # 씬 없음 → 배치 제외
    }
    monkeypatch.setattr(main.db, "fetch_scenes", lambda c, t: scenes_by[t])

    captured = {"scores": [], "states": []}
    monkeypatch.setattr(main.db, "upsert_scene_scores",
                        lambda c, rows: captured["scores"].extend(rows))
    monkeypatch.setattr(main.db, "set_label_state",
                        lambda c, t, s, e=None: captured["states"].append((t, s)))

    monkeypatch.setattr(main.batch, "build_requests", lambda movies: movies)
    monkeypatch.setattr(main.batch, "submit", lambda ac, reqs: "batch_x")
    monkeypatch.setattr(main.batch, "poll", lambda ac, bid: None)
    monkeypatch.setattr(main.batch, "collect", lambda ac, bid: iter([
        (7, {"scenes": [{"scene_index": 0, "arousal": 0.8, "valence": 0.2}]}, None),
    ]))

    main.run()

    assert captured["scores"] == [
        {"scenes_id": 100, "score": 0.8, "model_version": db.AROUSAL_MV},
        {"scenes_id": 100, "score": 0.2, "model_version": db.VALENCE_MV},
    ]
    assert (7, "done") in captured["states"]


def test_run_flags_failed(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "https://ai.test")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    monkeypatch.setattr(main, "Anthropic", lambda: object())
    monkeypatch.setattr(main.db, "ensure_model_versions", lambda c: None)
    monkeypatch.setattr(main.db, "fetch_label_targets", lambda c: [7])
    monkeypatch.setattr(main.db, "fetch_scenes", lambda c, t:
                        [{"scenes_id": 100, "scene_index": 0, "text": "a"}])
    states = []
    monkeypatch.setattr(main.db, "set_label_state", lambda c, t, s, e=None: states.append((t, s)))
    monkeypatch.setattr(main.db, "upsert_scene_scores", lambda c, rows: None)
    monkeypatch.setattr(main.batch, "build_requests", lambda movies: movies)
    monkeypatch.setattr(main.batch, "submit", lambda ac, reqs: "b")
    monkeypatch.setattr(main.batch, "poll", lambda ac, bid: None)
    monkeypatch.setattr(main.batch, "collect", lambda ac, bid: iter([(7, None, "batch result errored")]))

    main.run()
    assert states == [(7, "failed")]
```

- [ ] **Step 2: 실패 확인**

Run: `pytest tests/test_label_main.py -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'labeling.label_scenes'`)

- [ ] **Step 3: 구현**

`4K_ML/labeling/label_scenes.py`:

```python
#!/usr/bin/env python3
"""LLM 라벨링 배치 — vm5 scenes → scene_scores(Valence+Arousal).

env: AI_DATABASE_URL, AI_DATABASE_KEY (선택 AI_BASIC_*), ANTHROPIC_API_KEY,
     선택 LABEL_BATCH_ID(크래시 후 기존 배치 이어받기).
"""
import os

import httpx
from anthropic import Anthropic

from labeling import db, batch


def _clamp(x) -> float:
    return max(0.0, min(1.0, float(x)))


def parse_to_rows(parsed: dict, index_to_sid: dict[int, int]) -> list[dict]:
    """LLM 응답 → scene_scores 행(씬당 arousal/valence 2행). 매핑 없는 씬은 스킵."""
    rows = []
    for s in parsed["scenes"]:
        sid = index_to_sid.get(s["scene_index"])
        if sid is None:
            continue
        rows.append({"scenes_id": sid, "score": _clamp(s["arousal"]),
                     "model_version": db.AROUSAL_MV})
        rows.append({"scenes_id": sid, "score": _clamp(s["valence"]),
                     "model_version": db.VALENCE_MV})
    return rows


def run() -> None:
    if not os.getenv("AI_DATABASE_URL"):
        raise SystemExit("AI_DATABASE_URL 환경변수가 필요합니다 (vm5).")
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise SystemExit("ANTHROPIC_API_KEY 환경변수가 필요합니다.")
    ac = Anthropic()
    counts = {"done": 0, "failed": 0}
    with httpx.Client(timeout=60, verify=False) as client:
        db.ensure_model_versions(client)
        targets = db.fetch_label_targets(client)
        movies, sid_maps = [], {}
        for tmdb_id in targets:
            scenes = db.fetch_scenes(client, tmdb_id)
            if not scenes:
                continue
            movies.append((tmdb_id, scenes))
            sid_maps[tmdb_id] = {s["scene_index"]: s["scenes_id"] for s in scenes}
        if not movies:
            print("대상 없음")
            return

        batch_id = os.getenv("LABEL_BATCH_ID") or batch.submit(ac, batch.build_requests(movies))
        batch.poll(ac, batch_id)

        for tmdb_id, parsed, error in batch.collect(ac, batch_id):
            if error:
                db.set_label_state(client, tmdb_id, "failed", error[:500])
                counts["failed"] += 1
                print(f"tmdb={tmdb_id} FAILED: {error}")
                continue
            try:
                rows = parse_to_rows(parsed, sid_maps.get(tmdb_id, {}))
                db.upsert_scene_scores(client, rows)
                db.set_label_state(client, tmdb_id, "done")
                counts["done"] += 1
                print(f"tmdb={tmdb_id} scenes_scored={len(rows) // 2}")
            except Exception as e:  # noqa: BLE001
                db.set_label_state(client, tmdb_id, "failed", str(e)[:500])
                counts["failed"] += 1
                print(f"tmdb={tmdb_id} FAILED: {e}")
    print(f"완료: {counts}")


if __name__ == "__main__":
    run()
```

- [ ] **Step 4: 통과 확인**

Run: `pytest tests/test_label_main.py -v`
Expected: PASS (4개)

- [ ] **Step 5: 전체 테스트 회귀 확인**

Run: `pytest -q`
Expected: 기존 + 신규 라벨링 테스트 모두 PASS

- [ ] **Step 6: Commit**

```bash
git add 4K_ML/labeling/label_scenes.py 4K_ML/tests/test_label_main.py
git commit -m "feat: 라벨링 오케스트레이션 run()(제출→폴링→적재, 멱등)"
```

---

## Task 6: 배포 — Dockerfile · WorkflowTemplate · CI · 실행 yaml

**Files:**
- Modify: `4K_ML/Dockerfile` (COPY 라인)
- Create: `Ansible/manifests/4k-ml/workflowtemplate-llm-labeling.yaml`
- Create: `Ansible/manifests/test/llm-labeling-run.yaml`
- Modify: `.github/workflows/deploy-4k-ml.yml`

- [ ] **Step 1: Dockerfile에 labeling 패키지 복사 추가**

`4K_ML/Dockerfile`에서 `COPY subtitle_parse/ ./subtitle_parse/` 줄 **다음**에 추가:

```dockerfile
COPY labeling/ ./labeling/
```

- [ ] **Step 2: WorkflowTemplate 작성 (GPU 없음)**

`Ansible/manifests/4k-ml/workflowtemplate-llm-labeling.yaml`:

```yaml
# LLM 라벨링(D)을 vm5에서 실행. GPU 불필요(API 바운드).
# 제출: argo submit --from workflowtemplate/llm-labeling -n ai
apiVersion: argoproj.io/v1alpha1
kind: WorkflowTemplate
metadata:
  name: llm-labeling
  namespace: ai
spec:
  serviceAccountName: argo-workflow
  entrypoint: main
  templates:
    - name: main
      container:
        image: ghcr.io/sanggyoon/4k-ml:latest
        command: ["python", "-m", "labeling.label_scenes"]
        envFrom:
          - secretRef:
              name: 4k-ml-secrets
```

- [ ] **Step 3: 1회 실행용 Workflow 작성**

`Ansible/manifests/test/llm-labeling-run.yaml`:

```yaml
# llm-labeling WorkflowTemplate을 1회 실행. 제출: kubectl create -n ai -f 이파일
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  generateName: llm-labeling-
  namespace: ai
spec:
  workflowTemplateRef:
    name: llm-labeling
```

- [ ] **Step 4: CI에 새 WT 태그 bump 추가**

`.github/workflows/deploy-4k-ml.yml`의 `Update image tag in WorkflowTemplate` 스텝 `run:` 블록을 아래로 교체(라벨링 WT sed 1줄 추가):

```yaml
      - name: Update image tag in WorkflowTemplate
        run: |
          sed -i 's|image: ghcr.io/sanggyoon/4k-ml:.*|image: ghcr.io/sanggyoon/4k-ml:${{ steps.vars.outputs.sha }}|' \
            Ansible/manifests/4k-ml/workflowtemplate-subtitle-parse.yaml
          sed -i 's|image: ghcr.io/sanggyoon/4k-ml:.*|image: ghcr.io/sanggyoon/4k-ml:${{ steps.vars.outputs.sha }}|' \
            Ansible/manifests/4k-ml/workflowtemplate-llm-labeling.yaml
```

그리고 `Commit and push manifest update` 스텝의 `git add` 줄을 아래로 교체:

```yaml
          git add Ansible/manifests/4k-ml/workflowtemplate-subtitle-parse.yaml Ansible/manifests/4k-ml/workflowtemplate-llm-labeling.yaml
```

- [ ] **Step 5: YAML 문법 확인**

Run (저장소 루트에서):
```bash
python -c "import yaml; yaml.safe_load(open('Ansible/manifests/4k-ml/workflowtemplate-llm-labeling.yaml')); yaml.safe_load(open('Ansible/manifests/test/llm-labeling-run.yaml')); print('yaml ok')"
```
Expected: `yaml ok`

- [ ] **Step 6: Commit**

```bash
git add 4K_ML/Dockerfile Ansible/manifests/4k-ml/workflowtemplate-llm-labeling.yaml Ansible/manifests/test/llm-labeling-run.yaml .github/workflows/deploy-4k-ml.yml
git commit -m "build: 라벨링 Docker COPY + WorkflowTemplate(GPU 없음) + CI bump"
```

---

## 배포 후 수동 작업 (코드 외 — 사용자 실행)

이 단계는 plan 실행 대상이 아니라 사용자가 클러스터에서 직접 합니다. 완료 시 안내:

1. **`ANTHROPIC_API_KEY`를 `4k-ml-secrets`에 추가** (ns `ai`):
   ```bash
   kubectl create secret generic 4k-ml-secrets -n ai \
     --from-literal=ANTHROPIC_API_KEY='sk-ant-...' \
     --dry-run=client -o yaml | kubectl apply -f -
   ```
   (기존 키들 AI_DATABASE_URL/AI_DATABASE_KEY 등은 유지되도록 기존 secret을 edit하거나 전체 재생성.)
2. main 병합 → CI가 이미지 빌드 + WT 태그 bump → ArgoCD 동기화.
3. 실행: Argo UI(ns `ai`, `llm-labeling`) 또는 `kubectl create -n ai -f Ansible/manifests/test/llm-labeling-run.yaml`.
4. 라벨 스팟체크: `scene_scores`에서 `model_version like 'llm-va-v1%'` 조회, 점수 분포 확인.

---

## Self-Review 결과

**Spec coverage:** §2 결정(모델/배치/2축/절대앵커/멱등/GPU없음) → Task 4·5·6; §3 데이터모델(축별 model_version 행) → Task 3·5; §4 모듈구조 → Task 2~5; §5 비용(reason 제거 스키마) → Task 2; §6 배포 → Task 6; §7 테스트 → 각 Task. 누락 없음.

**Placeholder scan:** 모든 코드/명령 구체화. 단 `anthropic` 핀 버전은 Task 1 Step 3에서 설치 결과로 확정(환경 의존이라 의도적으로 런타임 결정).

**Type consistency:** `db.AROUSAL_MV`/`db.VALENCE_MV` 상수가 db·label_scenes·테스트에서 일관. `build_requests`는 `[(tmdb_id, scenes)]` 입력, `collect`는 `(tmdb_id, parsed, error)` 출력 — run()과 일치. `fetch_scenes` 반환 키(`scenes_id`/`scene_index`/`text`)가 prompt·run에서 동일 사용.
```