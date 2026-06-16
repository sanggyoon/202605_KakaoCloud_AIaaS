# 매니저 정리 + 삭제 리셋 + 기간 방문자 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매니저 페이지를 정리(스코어링 버튼 삭제·arousal 강조·외부링크·리스트 버튼 이동)하고, 영화 삭제 시 vm4 벡터 삭제+vm5 처리상태 pending 리셋, 기간 지정 방문자 수 조회를 추가한다.

**Architecture:** BE에 delete 정리 + 방문자 범위 카운트 엔드포인트 추가, FE 매니저 페이지/프록시 라우트 수정. #5는 변경 없음(정상).

**Tech Stack:** FastAPI(BE), Next.js(FE), Supabase REST(vm4/vm5). pytest / next build.

**선행 스펙:** `docs/superpowers/specs/2026-06-16-manager-tweaks-delete-cascade-design.md`

**경로:** BE=`4K_BE`, FE=`4K_FE`. git 루트=`/Users/sanggyoon/Documents/KakaoCloud_Project`. 커밋 끝:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## Task 1: BE — 삭제 시 벡터 삭제 + 처리상태 pending 리셋 (#4)

**Files:** Modify `4K_BE/app/main.py` · Test `4K_BE/tests/test_delete_movie.py`

- [ ] **Step 1: 실패 테스트 작성**

`4K_BE/tests/test_delete_movie.py`:
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


def test_delete_cleans_vector_and_resets_processing(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "http://vm5")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")
    hits = {"movies_del": 0, "vectors_del": 0, "proc_post": []}

    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if req.method == "DELETE" and "/rest/v1/movies" in url:
            hits["movies_del"] += 1
            return httpx.Response(204)
        if req.method == "DELETE" and "/rest/v1/movie_vectors" in url:
            hits["vectors_del"] += 1
            return httpx.Response(204)
        if req.method == "POST" and "/rest/v1/processing_status" in url:
            hits["proc_post"].append(req.content.decode())
            return httpx.Response(201, json=[])
        return httpx.Response(404)

    _patch(monkeypatch, handler)
    res = TestClient(main.app).delete("/api/movies/100")
    assert res.status_code == 200 and res.json()["ok"] is True
    assert hits["movies_del"] == 1
    assert hits["vectors_del"] == 1
    assert any("parse_state" in p and "pending" in p for p in hits["proc_post"])
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_BE && python -m pytest tests/test_delete_movie.py -q`
Expected: FAIL (벡터 삭제·processing 리셋 미구현)

- [ ] **Step 3: 구현 — `_reset_processing` 헬퍼 + delete_movie 보강**

`main.py`의 `delete_movie`를 다음으로 교체:
```python
async def _reset_processing(client: httpx.AsyncClient, tmdb_id: int) -> None:
    """vm5 processing_status를 pending으로 리셋(best-effort)."""
    url = os.getenv("AI_DATABASE_URL", "")
    key = os.getenv("AI_DATABASE_KEY", "")
    if not url or not key:
        return
    h = {"apikey": key, "Authorization": f"Bearer {key}",
         "Content-Type": "application/json",
         "Prefer": "resolution=merge-duplicates,return=minimal"}
    bu = os.getenv("AI_BASIC_USER")
    auth = (bu, os.getenv("AI_BASIC_PASS", "")) if bu else None
    row = {"tmdb_id": tmdb_id, "subtitle_state": "pending", "parse_state": "pending",
           "label_state": "pending", "score_state": "pending", "vector_state": "pending",
           "retry_count": 0, "error": None,
           "updated_at": datetime.now(timezone.utc).isoformat()}
    try:
        await client.post(f"{url}/rest/v1/processing_status",
                          params={"on_conflict": "tmdb_id"}, json=[row], headers=h, auth=auth)
    except Exception:  # noqa: BLE001 — best-effort
        pass


@app.delete("/api/movies/{tmdb_id}")
async def delete_movie(tmdb_id: int):
    """vm4 movies 삭제 + vm4 movie_vectors 삭제 + vm5 processing_status pending 리셋."""
    async with httpx.AsyncClient(timeout=15, verify=False) as client:
        sb_r = await client.delete(
            f"{DATA_URL}/rest/v1/movies",
            params={"tmdb_id": f"eq.{tmdb_id}"},
            headers=tc.sb_headers(),
        )
        if sb_r.status_code not in (200, 204):
            raise HTTPException(status_code=500, detail=f"Supabase 삭제 실패: {sb_r.text[:200]}")

        # vm4 벡터 삭제 (best-effort)
        try:
            await client.delete(f"{DATA_URL}/rest/v1/movie_vectors",
                                params={"tmdb_id": f"eq.{tmdb_id}"}, headers=tc.sb_headers())
        except Exception:  # noqa: BLE001
            pass

        # vm5 처리상태 pending 리셋 (best-effort)
        await _reset_processing(client, tmdb_id)

        return {"ok": True, "tmdb_id": tmdb_id}
```

- [ ] **Step 4: 통과 + 회귀**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_BE && python -m pytest tests/test_delete_movie.py -q`
Expected: 1 passed

- [ ] **Step 5: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_BE/app/main.py 4K_BE/tests/test_delete_movie.py
git commit -m "feat(manager): 영화 삭제 시 벡터 삭제 + vm5 처리상태 pending 리셋

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: BE — 기간 방문자 수 `/api/visits/range` (#6)

**Files:** Modify `4K_BE/app/main.py` · Test `4K_BE/tests/test_visits_range.py`

- [ ] **Step 1: 실패 테스트 작성**

`4K_BE/tests/test_visits_range.py`:
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


def test_visits_range_counts(monkeypatch):
    seen = {}

    def handler(req):
        if "/rest/v1/visits" in str(req.url):
            seen["url"] = str(req.url)
            return httpx.Response(206, json=[], headers={"Content-Range": "0-0/7"})
        return httpx.Response(404)

    _patch(monkeypatch, handler)
    res = TestClient(main.app).get("/api/visits/range?start=2026-06-01&end=2026-06-07")
    assert res.status_code == 200
    assert res.json()["count"] == 7
    assert "created_at.gte.2026-06-01" in seen["url"]
    assert "created_at.lt.2026-06-08" in seen["url"]  # end+1일


def test_visits_range_bad_date(monkeypatch):
    _patch(monkeypatch, lambda req: httpx.Response(200, json=[]))
    res = TestClient(main.app).get("/api/visits/range?start=2026-13-01&end=2026-06-07")
    assert res.status_code == 400
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_BE && python -m pytest tests/test_visits_range.py -q`
Expected: FAIL (라우트 없음)

- [ ] **Step 3: 구현 — 엔드포인트 추가**

`main.py`의 `stats()` 정의 근처(또는 `log_visit` 아래)에 추가(`datetime`,`timedelta`는 이미 import됨):
```python
@app.get("/api/visits/range")
async def visits_range(start: str, end: str):
    """기간 [start, end] (YYYY-MM-DD, 양끝 포함) 방문자 수."""
    try:
        s = datetime.strptime(start, "%Y-%m-%d").date()
        e = datetime.strptime(end, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="날짜 형식은 YYYY-MM-DD")
    if s > e:
        raise HTTPException(status_code=400, detail="시작일이 종료일보다 늦습니다")
    e_plus = e + timedelta(days=1)
    cond = f"(created_at.gte.{s.isoformat()}T00:00:00,created_at.lt.{e_plus.isoformat()}T00:00:00)"
    async with httpx.AsyncClient(timeout=15, verify=False) as client:
        count = await _count(client, "visits", {"and": cond})
    return {"start": start, "end": end, "count": count}
```

- [ ] **Step 4: 통과 확인**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_BE && python -m pytest tests/test_visits_range.py -q`
Expected: 2 passed

- [ ] **Step 5: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_BE/app/main.py 4K_BE/tests/test_visits_range.py
git commit -m "feat(manager): 기간 지정 방문자 수 /api/visits/range

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: FE 프록시 — visits/range

**Files:** Create `4K_FE/app/api/manager/visits/range/route.ts`

- [ ] **Step 1: 프록시 작성**

`4K_FE/app/api/manager/visits/range/route.ts`:
```ts
const BE_URL = process.env.BE_INTERNAL_URL ?? 'http://localhost:8000';

export async function GET(request: Request) {
  const qs = new URL(request.url).searchParams.toString();
  const res = await fetch(`${BE_URL}/api/visits/range?${qs}`, { cache: 'no-store' });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
```

- [ ] **Step 2: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/api/manager/visits/range/route.ts
git commit -m "feat(manager): visits/range Next 프록시 라우트

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: FE 매니저 페이지 — #1·#2·#3·#6·#7

**Files:** Modify `4K_FE/app/manager/page.tsx`

- [ ] **Step 1: 상태 추가 (기간 방문자)**

`const [activeModel, ...]` 아래에 추가:
```tsx
  const _today = new Date().toISOString().slice(0, 10);
  const _monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [vStart, setVStart] = useState(_monthAgo);
  const [vEnd, setVEnd] = useState(_today);
  const [rangeCount, setRangeCount] = useState<number | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);

  const fetchRange = async () => {
    if (vStart > vEnd) return;
    setRangeLoading(true);
    try {
      const res = await fetch(`/api/manager/visits/range?start=${vStart}&end=${vEnd}`, { cache: 'no-store' });
      const d = await res.json();
      setRangeCount(typeof d.count === 'number' ? d.count : null);
    } catch {
      setRangeCount(null);
    } finally {
      setRangeLoading(false);
    }
  };
```

- [ ] **Step 2: 방문자 통계 섹션에 기간 조회 UI 추가 (#6)**

방문자 통계 `<section>`의 `</div>`(cardGrid 닫힘) 다음, `</section>` 직전에 추가:
```tsx
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <input type="date" value={vStart} max={vEnd} onChange={(e) => setVStart(e.target.value)} style={numInput} />
            <span style={{ color: 'rgba(255,255,255,0.4)' }}>~</span>
            <input type="date" value={vEnd} min={vStart} max={_today} onChange={(e) => setVEnd(e.target.value)} style={numInput} />
            <button onClick={fetchRange} disabled={rangeLoading || vStart > vEnd} style={actionBtn(rangeLoading || vStart > vEnd)}>
              {rangeLoading ? '조회 중…' : '기간 방문자 조회'}
            </button>
            {rangeCount !== null && (
              <span style={{ fontSize: 14, fontWeight: 700 }}>
                {rangeCount.toLocaleString('ko-KR')}명
              </span>
            )}
          </div>
```

- [ ] **Step 3: 활성 모델 카드 arousal 강조 (#2)**

활성 모델 `<section>` 내부의 `<div style={cardGrid}>...</div>`를 다음으로 교체:
```tsx
          <div style={cardGrid}>
            <StatCard label="버전" value={activeModel?.version ?? '—'} accent />
            <StatCard label="Spearman · arousal" value={fmtMetric(activeModel?.metrics?.spearman_movie_arousal)} accent />
            <StatCard label="MAE · arousal" value={fmtMetric(activeModel?.metrics?.mae_arousal)} accent />
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
            valence — Spearman {fmtMetric(activeModel?.metrics?.spearman_movie_valence)} · MAE {fmtMetric(activeModel?.metrics?.mae_valence)}
          </div>
```

- [ ] **Step 4: 바로가기(링크) 섹션 추가 (#3·#7), 기능 섹션에서 리스트/스코어링 버튼 제거 (#1·#7)**

"기능 버튼" `<section>`의 다음 두 블록을 제거:
```tsx
            <button onClick={() => router.push('/movie_list')} style={actionBtn(false)}>
              영화 정보 리스트 →
            </button>
```
와
```tsx
            <button
              disabled
              title="추후 개발된 모델로 동작 예정"
              style={{ ...actionBtn(true), cursor: 'not-allowed' }}
            >
              영화 데이터 스코어링 (준비 중)
            </button>
```

그리고 "기능 버튼" `</section>` 바로 다음에 새 섹션 추가:
```tsx
        {/* 바로가기 */}
        <section>
          <h2 style={sectionTitle}>바로가기</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <button onClick={() => router.push('/movie_list')} style={actionBtn(false)}>영화 정보 리스트 →</button>
            {[
              { label: 'Grafana', href: 'https://grafana.peakly.art' },
              { label: 'ArgoCD', href: 'https://argocd.peakly.art' },
              { label: 'Argo Workflow', href: 'https://workflow.peakly.art' },
              { label: 'SVC DB (data)', href: 'https://data.peakly.art' },
              { label: 'AI DB (ai)', href: 'https://ai.peakly.art' },
            ].map((l) => (
              <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer"
                 style={{ ...actionBtn(false), textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                {l.label} ↗
              </a>
            ))}
          </div>
        </section>
```

- [ ] **Step 5: 빌드(타입체크)**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE && npm run build 2>&1 | grep -E "Compiled|Failed|Error"`
Expected: `✓ Compiled successfully`

- [ ] **Step 6: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/manager/page.tsx
git commit -m "feat(manager): 스코어링 버튼 삭제·arousal 강조·바로가기 섹션·기간 방문자

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: 마무리

- [ ] **Step 1: 전체 테스트**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_BE && python -m pytest -q
cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE && npm run build 2>&1 | grep -E "Compiled|Failed|Error"
```
Expected: BE 통과, FE Compiled.

- [ ] **Step 2: 수동 확인 안내 (배포 후)**

- 매니저: 스코어링(준비중) 버튼 없음 / 활성모델 arousal 강조+valence 보조줄 / 바로가기 섹션(영화리스트+외부링크 새탭) / 방문자 통계에 기간 조회.
- 영화 삭제 → 재추가 시 처리상태 pending에서 재처리되는지(크론/수동).

- [ ] **Step 3: finishing-a-development-branch**

**REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch

---

## Self-Review 메모

- **스펙 커버리지:** #1=T4(스코어링 버튼 제거), #2=T4(arousal 강조), #3=T4(외부링크), #4=T1(삭제 정리), #5=변경없음, #6=T2(BE range)+T3(프록시)+T4(UI), #7=T4(리스트 버튼 이동).
- **타입 일관성:** `_reset_processing(client, tmdb_id)`, `visits_range(start, end)→{start,end,count}`, FE `fetchRange`/`rangeCount`, `fmtMetric`/`actionBtn`/`numInput`/`cardGrid`/`sectionTitle` 기존 재사용.
- **placeholder:** 코드 스텝 완전. #5 무변경 명시.
- **엣지:** vm5 env 없으면 처리리셋 스킵(삭제는 성공); 잘못된 날짜 400; 시작>종료 버튼 비활성.
