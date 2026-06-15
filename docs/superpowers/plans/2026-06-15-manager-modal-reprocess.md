# 매니저 모달 처리정보·단건 재처리 + 활성모델 지표 카드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매니저 영화 모달에 처리현황 + 단건 재처리(자막 강제 재수집+다운스트림 리셋)를 더하고 클라이맥스 벡터 섹션을 제거하며, 매니저 페이지에 활성모델 지표 카드를 추가한다.

**Architecture:** BE에 단건 재처리/processing/active-model metrics 엔드포인트 추가(vm5·subdl 재사용), FE 모달에서 벡터 섹션 제거 + 처리현황/버튼 추가, 매니저 페이지에 카드. Next 프록시 라우트 2개.

**Tech Stack:** FastAPI(BE), Next.js(FE), Supabase REST(vm4/vm5), subdl. pytest / next build.

**선행 스펙:** `docs/superpowers/specs/2026-06-15-manager-modal-reprocess-design.md`

**경로:** BE=`4K_BE`, FE=`4K_FE`. git 루트=`/Users/sanggyoon/Documents/KakaoCloud_Project`. 커밋 끝:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## 사전 메모

- `subtitle_collect.py`(별칭 `sc`)에 `search/choose/download_and_extract/save_subtitle/set_status/ai_url/ai_headers/_ai_auth/SubdlRateLimit` 존재 → 단건 재사용.
- `set_status`/`save_subtitle`는 `processing_status`/`subtitles`에 `on_conflict=tmdb_id` 업서트(merge). 같은 패턴으로 다운스트림 리셋.
- main.py는 `from app import subtitle_collect as sc`, `tmdb_common as tc` 임포트됨. vm5 REST는 `os.getenv("AI_DATABASE_URL"/"AI_DATABASE_KEY")` + apikey/Bearer(이미 `active_model`/`_processing_counts`에서 사용).
- 모달은 `4K_FE/app/components/MovieDetailModal.tsx`. detail은 `/api/manager/movies/{tmdb}` → BE `/api/movies/{tmdb}/detail` `{movie, vector}`.

---

## Task 1: BE — 단건 자막 재수집 + 다운스트림 리셋 (`subtitle_collect.py`)

**Files:** Modify `4K_BE/app/subtitle_collect.py` · Test `4K_BE/tests/test_collect_one.py`

- [ ] **Step 1: 실패 테스트 작성**

`4K_BE/tests/test_collect_one.py`:
```python
import httpx, pytest
from app import subtitle_collect as sc


def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_collect_one_done_and_reset(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "https://ai.test")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")
    monkeypatch.setenv("SUBDL_API_KEY", "s")
    posted = []

    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if "api.subdl.com" in url and "/subtitle/" in url:  # download
            # zip 추출은 monkeypatch로 우회되므로 여기 도달 안 함
            return httpx.Response(200, content=b"")
        if "api.subdl.com" in url:  # search
            return httpx.Response(200, json={"subtitles": [
                {"url": "/subtitle/x.zip", "language": "EN", "lang": "english", "hi": True,
                 "release_name": "X", "full_season": False}]})
        if "/rest/v1/subtitles" in url:
            return httpx.Response(201, json=[])
        if "/rest/v1/processing_status" in url:
            posted.append(req.content.decode())
            return httpx.Response(201, json=[])
        return httpx.Response(404)

    monkeypatch.setattr(sc, "download_and_extract", _fake_dl)
    async with _client(handler) as c:
        res = await sc.collect_one(c, 100)
        await sc.reset_downstream(c, 100)
    assert res["state"] == "done"
    assert any("parse_state" in p and "pending" in p for p in posted)  # 리셋 발생


async def _fake_dl(client, url_path):
    return "1\n00:00:01,000 --> 00:00:03,000\nhello\n"


@pytest.mark.asyncio
async def test_collect_one_skipped_when_no_subtitle(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "https://ai.test")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")
    monkeypatch.setenv("SUBDL_API_KEY", "s")

    def handler(req):
        if "api.subdl.com" in str(req.url):
            return httpx.Response(200, json={"subtitles": []})
        return httpx.Response(201, json=[])

    async with _client(handler) as c:
        res = await sc.collect_one(c, 100)
    assert res["state"] == "skipped"
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_BE && python -m pytest tests/test_collect_one.py -q`
Expected: FAIL (`collect_one`/`reset_downstream` 없음)

- [ ] **Step 3: 구현 — `subtitle_collect.py`에 추가**

`set_status` 함수 정의 아래(또는 `collect_events` 위)에 추가:
```python
async def collect_one(client: httpx.AsyncClient, tmdb_id: int) -> dict:
    """단건 강제 자막 재수집(상태 게이트 무시). {'state':..., 'message':...}."""
    try:
        chosen = choose(await search(client, tmdb_id))
        if chosen is None:
            await set_status(client, tmdb_id, "skipped")
            return {"state": "skipped", "message": "영어 자막 없음"}
        raw = await download_and_extract(client, chosen.get("url") or "")
        if not raw.strip():
            await set_status(client, tmdb_id, "failed", "empty srt")
            return {"state": "failed", "message": "빈 자막 파일"}
        await save_subtitle(client, tmdb_id, chosen, raw)
        await set_status(client, tmdb_id, "done")
        return {"state": "done", "message": chosen.get("release_name") or "수집 완료"}
    except SubdlRateLimit:
        return {"state": "failed", "message": "subdl 호출 한도 초과"}
    except Exception as e:  # noqa: BLE001
        await set_status(client, tmdb_id, "failed", str(e)[:500])
        return {"state": "failed", "message": str(e)[:200]}


async def reset_downstream(client: httpx.AsyncClient, tmdb_id: int) -> None:
    """parse/score/vector 상태를 pending으로 리셋(label 유지) → 재처리 유도."""
    row = {"tmdb_id": tmdb_id, "parse_state": "pending", "score_state": "pending",
           "vector_state": "pending", "updated_at": datetime.now(timezone.utc).isoformat()}
    r = await client.post(f"{ai_url()}/rest/v1/processing_status",
                          params={"on_conflict": "tmdb_id"}, json=[row],
                          headers=ai_headers(write=True), auth=_ai_auth())
    if r.status_code not in (200, 201, 204):
        raise RuntimeError(f"reset 실패 {r.status_code}: {r.text[:200]}")
```

- [ ] **Step 4: 통과 확인**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_BE && python -m pytest tests/test_collect_one.py -q`
Expected: 2 passed

- [ ] **Step 5: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_BE/app/subtitle_collect.py 4K_BE/tests/test_collect_one.py
git commit -m "feat(manager): 단건 자막 강제 재수집(collect_one) + 다운스트림 리셋

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: BE — reprocess/detail processing/active-model metrics (`main.py`)

**Files:** Modify `4K_BE/app/main.py` · Test `4K_BE/tests/test_reprocess.py`

- [ ] **Step 1: 실패 테스트 작성**

`4K_BE/tests/test_reprocess.py`:
```python
import httpx, pytest
from fastapi.testclient import TestClient
from app import main


def _patch(monkeypatch, handler):
    orig = httpx.AsyncClient

    def factory(*a, **k):
        k.pop("timeout", None); k.pop("verify", None)
        return orig(transport=httpx.MockTransport(handler))

    monkeypatch.setattr(main.httpx, "AsyncClient", factory)


def test_reprocess_resets_downstream(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "http://vm5")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")
    monkeypatch.setenv("SUBDL_API_KEY", "s")
    posted = []

    async def fake_one(client, tmdb_id):
        return {"state": "done", "message": "OK"}

    async def fake_reset(client, tmdb_id):
        posted.append(tmdb_id)

    monkeypatch.setattr(main.sc, "collect_one", fake_one)
    monkeypatch.setattr(main.sc, "reset_downstream", fake_reset)
    _patch(monkeypatch, lambda req: httpx.Response(200, json=[]))

    res = TestClient(main.app).post("/api/movies/100/reprocess")
    assert res.status_code == 200
    assert res.json()["subtitle"] == "done"
    assert posted == [100]   # done이라 리셋됨


def test_active_model_includes_metrics(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "http://vm5")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")

    def handler(req):
        if "/rest/v1/model_versions" in str(req.url):
            return httpx.Response(200, json=[{"model_version": "roberta-va-v1",
                                              "metrics": {"spearman_movie_arousal": 0.75}}])
        return httpx.Response(404)

    _patch(monkeypatch, handler)
    res = TestClient(main.app).get("/api/active-model")
    assert res.json()["version"] == "roberta-va-v1"
    assert res.json()["metrics"]["spearman_movie_arousal"] == 0.75
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_BE && python -m pytest tests/test_reprocess.py -q`
Expected: FAIL (`/reprocess` 라우트 없음, active-model metrics 없음)

- [ ] **Step 3: 구현 — reprocess 엔드포인트 추가**

`main.py`의 `update_movie`(PATCH) 정의 근처(또는 movie_detail 아래)에 추가:
```python
@app.post("/api/movies/{tmdb_id}/reprocess")
async def reprocess_movie(tmdb_id: int):
    """단건 자막 강제 재수집 → 성공 시 parse/score/vector 리셋(크론·GPU가 재처리)."""
    async with httpx.AsyncClient(timeout=120, verify=False) as client:
        result = await sc.collect_one(client, tmdb_id)
        if result["state"] == "done":
            await sc.reset_downstream(client, tmdb_id)
        return {"subtitle": result["state"], "message": result["message"]}
```

- [ ] **Step 4: 구현 — `/api/active-model`에 metrics 포함**

`active_model()` 내부 쿼리 `params`의 select를 `model_version,metrics`로 바꾸고, 반환을 metrics 포함으로:
```python
            r = await client.get(
                f"{url}/rest/v1/model_versions",
                params={"select": "model_version,metrics", "active": "eq.true"},
                headers=headers, auth=auth,
            )
            if r.status_code in (200, 206):
                for row in r.json():
                    mv = row.get("model_version", "")
                    if mv and "::" not in mv:
                        return {"version": mv, "metrics": row.get("metrics") or {}}
    return {"version": "roberta-va-v1", "metrics": {}}
```

- [ ] **Step 5: 구현 — movie_detail에 processing 추가**

`main.py`에 헬퍼 추가(예: `_processing_counts` 근처):
```python
async def _movie_processing(client: httpx.AsyncClient, tmdb_id: int) -> dict:
    """vm5: 한 영화의 상태(5개+retry) + 개수(scenes/dialogues/활성 score)."""
    url = os.getenv("AI_DATABASE_URL", "")
    key = os.getenv("AI_DATABASE_KEY", "")
    if not url or not key:
        return {}
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    bu = os.getenv("AI_BASIC_USER")
    auth = (bu, os.getenv("AI_BASIC_PASS", "")) if bu else None

    async def _count(table, params):
        ch = {**h, "Prefer": "count=exact", "Range-Unit": "items", "Range": "0-0"}
        r = await client.get(f"{url}/rest/v1/{table}", params={"select": "id", **params},
                             headers=ch, auth=auth)
        return _parse_count(r.headers.get("content-range")) if r.status_code in (200, 206) else 0

    ps = await client.get(f"{url}/rest/v1/processing_status",
                          params={"select": "subtitle_state,parse_state,label_state,score_state,vector_state,retry_count",
                                  "tmdb_id": f"eq.{tmdb_id}", "limit": "1"}, headers=h, auth=auth)
    states = (ps.json()[0] if ps.status_code in (200, 206) and ps.json() else {})

    subs = await client.get(f"{url}/rest/v1/subtitles",
                            params={"select": "id", "tmdb_id": f"eq.{tmdb_id}", "limit": "1"},
                            headers=h, auth=auth)
    sid = subs.json()[0]["id"] if subs.status_code in (200, 206) and subs.json() else None
    scenes = dialogues = scores_active = 0
    if sid is not None:
        scenes = await _count("scenes", {"subtitles_id": f"eq.{sid}"})
        dialogues = await _count("dialogues", {"subtitles_id": f"eq.{sid}"})
        sc_rows = await client.get(f"{url}/rest/v1/scenes",
                                   params={"select": "id", "subtitles_id": f"eq.{sid}", "limit": "100000"},
                                   headers=h, auth=auth)
        ids = [r["id"] for r in (sc_rows.json() if sc_rows.status_code in (200, 206) else [])]
        if ids:
            mv = await _active_base(client)
            in_list = ",".join(str(i) for i in ids)
            ss = await client.get(f"{url}/rest/v1/scene_scores",
                                  params={"select": "scenes_id", "scenes_id": f"in.({in_list})",
                                          "model_version": f"eq.{mv}::arousal", "limit": "100000"},
                                  headers=h, auth=auth)
            scores_active = len(ss.json()) if ss.status_code in (200, 206) else 0
    return {"states": states, "counts": {"scenes": scenes, "dialogues": dialogues,
                                         "scores_active": scores_active}}


async def _active_base(client: httpx.AsyncClient) -> str:
    url = os.getenv("AI_DATABASE_URL", ""); key = os.getenv("AI_DATABASE_KEY", "")
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    bu = os.getenv("AI_BASIC_USER"); auth = (bu, os.getenv("AI_BASIC_PASS", "")) if bu else None
    r = await client.get(f"{url}/rest/v1/model_versions",
                         params={"select": "model_version", "active": "eq.true"}, headers=h, auth=auth)
    if r.status_code in (200, 206):
        for row in r.json():
            mv = row.get("model_version", "")
            if mv and "::" not in mv:
                return mv
    return "roberta-va-v1"
```
그리고 `movie_detail`의 `return`을 다음으로 교체:
```python
        processing = await _movie_processing(client, tmdb_id)
        return {"movie": movie_rows[0], "vector": vector_row, "processing": processing}
```

- [ ] **Step 6: 통과 + 회귀**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_BE && python -m pytest tests/test_reprocess.py tests/test_active_model.py tests/test_stats.py -q`
Expected: 통과.

- [ ] **Step 7: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_BE/app/main.py 4K_BE/tests/test_reprocess.py
git commit -m "feat(manager): reprocess 엔드포인트 + detail processing + active-model metrics

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: FE 프록시 라우트 2개

**Files:** Create `4K_FE/app/api/manager/movies/[tmdb_id]/reprocess/route.ts`, `4K_FE/app/api/manager/active-model/route.ts`

- [ ] **Step 1: reprocess 프록시**

`4K_FE/app/api/manager/movies/[tmdb_id]/reprocess/route.ts`:
```ts
const BE_URL = process.env.BE_INTERNAL_URL ?? 'http://localhost:8000';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ tmdb_id: string }> },
) {
  const { tmdb_id } = await params;
  const res = await fetch(`${BE_URL}/api/movies/${tmdb_id}/reprocess`, {
    method: 'POST',
    cache: 'no-store',
  });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
```

- [ ] **Step 2: active-model 프록시**

`4K_FE/app/api/manager/active-model/route.ts`:
```ts
const BE_URL = process.env.BE_INTERNAL_URL ?? 'http://localhost:8000';

export async function GET() {
  const res = await fetch(`${BE_URL}/api/active-model`, { cache: 'no-store' });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
```

- [ ] **Step 3: 빌드 + 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE && npm run build 2>&1 | grep -E "Compiled|Failed|Error"
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/api/manager/movies/\[tmdb_id\]/reprocess/route.ts 4K_FE/app/api/manager/active-model/route.ts
git commit -m "feat(manager): reprocess·active-model Next 프록시 라우트

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: FE 모달 — 벡터 섹션 제거 + 처리현황 + 재처리 버튼

**Files:** Modify `4K_FE/app/components/MovieDetailModal.tsx`

- [ ] **Step 1: 타입 — DetailResponse에 processing 추가, VectorRow 제거**

`interface DetailResponse {...}`를 다음으로 교체(그리고 `interface VectorRow {...}` 블록 삭제):
```ts
interface ProcessingInfo {
  states?: Record<string, string | number | null>;
  counts?: { scenes?: number; dialogues?: number; scores_active?: number };
}

interface DetailResponse {
  movie: MovieMeta | null;
  processing?: ProcessingInfo;
  detail?: string;
}
```
그리고 `parseVector` 함수 전체 삭제(이제 미사용).

- [ ] **Step 2: state 교체**

`const [vectorRow, ...]`·`const [vectorText, ...]` 두 줄을 다음으로 교체:
```ts
  const [processing, setProcessing] = useState<ProcessingInfo | null>(null);
  const [reprocessing, setReprocessing] = useState(false);
```

- [ ] **Step 3: load() — 벡터 대신 processing**

load() 내부에서
```ts
      setMeta(data.movie);
      setVectorRow(data.vector);
```
및 그 아래
```ts
      const vec = parseVector(data.vector?.vector);
      setVectorText(vec.length ? JSON.stringify(vec) : '');
```
를 다음으로 교체(2번째 블록은 삭제하고 setProcessing 추가):
```ts
      setMeta(data.movie);
      setProcessing(data.processing ?? null);
```

- [ ] **Step 4: handleSave — vector payload 제거**

handleSave에서 `const payload: { movie...; vector?... } = { movie };`부터 벡터 파싱 블록(`const vt = vectorText.trim();` ~ `payload.vector = parsed as number[];` 닫는 `}`)까지를 다음 한 줄로 교체:
```ts
      const payload = { movie };
```

- [ ] **Step 5: 재처리 핸들러 추가**

handleRefresh 함수 정의 아래에 추가:
```ts
  const handleReprocess = async () => {
    if (!window.confirm('subdl에서 자막을 강제로 다시 받고, 파싱·스코어·벡터를 재처리 대기로 되돌립니다. 계속할까요?')) return;
    setReprocessing(true);
    setSaveMsg(null);
    try {
      const res = await fetch(`/api/manager/movies/${tmdbId}/reprocess`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setSaveMsg(data.detail ?? '재처리에 실패했습니다.');
        return;
      }
      setSaveMsg(`자막: ${data.subtitle} — ${data.message ?? ''} ✓`);
      await load();
    } catch {
      setSaveMsg('재처리 중 오류가 발생했습니다.');
    } finally {
      setReprocessing(false);
    }
  };
```

- [ ] **Step 6: 렌더 — 벡터 KV 4줄을 처리현황으로 교체**

사이드바의 벡터 KV 블록
```tsx
                  <Badge label="벡터" value={meta?.has_vector ? '있음 ✓' : '없음'} ok={!!meta?.has_vector} />
                  <KV k="벡터 버전" v={vectorRow?.vector_version ?? '—'} />
                  <KV k="정규화" v={vectorRow?.normalization ?? '—'} />
                  <KV k="스무딩" v={vectorRow?.smoothing_method ?? '—'} />
                  <KV k="차원 수" v={vecPreview.length ? `${vecPreview.length}` : '—'} />
```
를 다음으로 교체:
```tsx
                  <Badge label="벡터" value={meta?.has_vector ? '있음 ✓' : '없음'} ok={!!meta?.has_vector} />
                  <KV k="자막" v={String(processing?.states?.subtitle_state ?? '—')} />
                  <KV k="파싱" v={String(processing?.states?.parse_state ?? '—')} />
                  <KV k="라벨" v={String(processing?.states?.label_state ?? '—')} />
                  <KV k="스코어" v={String(processing?.states?.score_state ?? '—')} />
                  <KV k="벡터화" v={String(processing?.states?.vector_state ?? '—')} />
                  <KV k="씬/대사/점수" v={`${processing?.counts?.scenes ?? 0} / ${processing?.counts?.dialogues ?? 0} / ${processing?.counts?.scores_active ?? 0}`} />
```
그리고 `const vecPreview = parseVector(vectorRow?.vector);` 라인 삭제.

- [ ] **Step 7: 렌더 — 클라이맥스 벡터 Section 삭제**

`{/* 클라이맥스 벡터 (씬 스코어 시계열) 수정 */}` 주석부터 그 `<Section>...</Section>` 닫힘까지 전체 삭제.

- [ ] **Step 8: footer — 재처리 버튼 추가**

footer의 "TMDB에서 갱신" 버튼(`<button onClick={handleRefresh}...>...</button>`) 바로 아래에 추가:
```tsx
            <button onClick={handleReprocess} disabled={reprocessing || saving || refreshing} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 7,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: 600,
              fontFamily: 'inherit', cursor: (reprocessing || saving || refreshing) ? 'not-allowed' : 'pointer',
              opacity: (reprocessing || saving || refreshing) ? 0.5 : 1, marginLeft: 8,
            }}>
              <span style={{ fontSize: 13 }}>⟳</span>
              {reprocessing ? '재처리 중...' : '이 영화 다시 처리 (자막 재수집)'}
            </button>
```

- [ ] **Step 9: 빌드(타입체크) — 미사용 식별자 정리 확인**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE && npm run build 2>&1 | grep -E "Compiled|Failed|Error|is defined but never used"`
Expected: `✓ Compiled successfully`. (벡터 관련 미사용 식별자 에러가 나면 해당 잔재 삭제 — VectorRow/parseVector/vectorRow/vectorText/vecPreview 모두 제거됐는지 확인.)

- [ ] **Step 10: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/components/MovieDetailModal.tsx
git commit -m "feat(manager): 모달 벡터섹션 제거 + 처리현황 + 이 영화 다시 처리 버튼

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: FE 매니저 페이지 — 활성모델 지표 카드

**Files:** Modify `4K_FE/app/manager/page.tsx`

- [ ] **Step 1: 상태 + fetch 추가**

`manager/page.tsx`의 `const [stats, ...]` 근처에 추가:
```tsx
  const [activeModel, setActiveModel] = useState<{ version: string; metrics: Record<string, number> } | null>(null);
```
stats를 불러오는 useEffect 안(또는 별도 useEffect)에서:
```tsx
    fetch('/api/manager/active-model', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setActiveModel(d))
      .catch(() => {});
```

- [ ] **Step 2: 카드 렌더 (처리 현황 섹션 위 또는 방문자 섹션 아래)**

적절한 위치(예: "처리 현황" `<section>` 바로 위)에 추가:
```tsx
        {/* 활성 모델 */}
        <section>
          <h2 style={sectionTitle}>활성 모델</h2>
          <div style={cardGrid}>
            <StatCard label="버전" value={activeModel?.version ?? '—'} accent />
            <StatCard label="Spearman(arousal)" value={fmtMetric(activeModel?.metrics?.spearman_movie_arousal)} />
            <StatCard label="MAE(arousal)" value={fmtMetric(activeModel?.metrics?.mae_arousal)} />
            <StatCard label="Spearman(valence)" value={fmtMetric(activeModel?.metrics?.spearman_movie_valence)} />
          </div>
        </section>
```
그리고 파일 하단 유틸 근처에 추가:
```tsx
function fmtMetric(n: number | undefined): string {
  return typeof n === 'number' ? n.toFixed(3) : '—';
}
```

- [ ] **Step 3: 빌드 + 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE && npm run build 2>&1 | grep -E "Compiled|Failed|Error"
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/manager/page.tsx
git commit -m "feat(manager): 활성 모델 + 지표(Spearman/MAE) 카드

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: 마무리

- [ ] **Step 1: 전체 테스트**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_BE && python -m pytest -q
cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE && npm run build 2>&1 | grep -E "Compiled|Failed|Error"
```
Expected: BE 통과, FE Compiled.

- [ ] **Step 2: 수동 확인 안내 (배포 후)**

- 매니저 모달: 클라이맥스 벡터 섹션 사라짐, 처리현황(상태5+개수) 표시, "이 영화 다시 처리" → 자막 재수집·다운스트림 pending → 크론/GPU가 재처리.
- 매니저 페이지: 활성 모델 버전 + 지표 카드.

- [ ] **Step 3: finishing-a-development-branch**

**REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch

---

## Self-Review 메모

- **스펙 커버리지:** #1 처리정보=T2(detail processing)+T4(렌더); #2 재처리=T1(collect_one/reset)+T2(reprocess)+T3(프록시)+T4(버튼); #3 벡터 제거=T4; #4 활성모델 카드=T2(metrics)+T3(프록시)+T5.
- **타입 일관성:** BE `collect_one→{state,message}`, `reprocess→{subtitle,message}`, `active-model→{version,metrics}`, `detail.processing={states,counts}`. FE `ProcessingInfo` 필드가 BE와 일치. `fmtMetric`/`StatCard`/`sectionTitle`/`cardGrid` 기존 재사용.
- **placeholder:** 코드 스텝 완전. 모달은 큰 파일이라 정확한 old→new 블록 제시(잔재 식별자 삭제는 빌드 에러로 검출).
- **엣지:** 자막 skipped/failed면 다운스트림 리셋 안 함(변경 없으니); 활성 metrics 없으면 '—'; vm5 env 없으면 processing {}.
