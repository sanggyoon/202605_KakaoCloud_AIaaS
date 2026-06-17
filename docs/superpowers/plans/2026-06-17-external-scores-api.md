# 외부 점수 API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 외부(서버→서버) 호출자가 `GET /api/movies/[tmdb_id]/scores`로 영화의 원본 scene_scores 타임라인(arousal/valence/progress_ratio)을 `X-API-Key` 인증으로 받게 한다.

**Architecture:** vm5(AI DB, `ai.peakly.art`)의 `scenes`/`scene_scores`를 서버 사이드에서 PostgREST 2-스텝으로 조회해 scene_index 순 병렬 배열로 조립한다. 데이터 접근 계층(`app/lib/aiDb.ts`)과 HTTP 계층(route handler)을 분리한다. FE 기존 vm4(`data.peakly.art`) 접근과 완전히 별개다.

**Tech Stack:** Next.js 16.2.5 App Router Route Handler (TypeScript), vm5 Supabase PostgREST, `fetch`.

## Global Constraints

- 코드 작성 전 `node_modules/next/dist/docs/`로 라우트 핸들러 시그니처 확인 (커스텀 Next — `4K_FE/AGENTS.md`). **확정된 시그니처:** `export async function GET(request: Request, { params }: { params: Promise<{ tmdb_id: string }> })`, `const { tmdb_id } = await params;`, 응답은 `Response.json(body, { status })`. (기존 `app/api/manager/movies/[tmdb_id]/route.ts` 패턴.)
- 작업 디렉토리: `4K_FE/`. import alias: `@/*` → `./*` (예: `@/app/lib/aiDb`).
- **JS 테스트 러너 없음.** 검증 사이클 = `npx tsc --noEmit` + `npx eslint <변경파일>`(변경 파일만 클린) + `npm run build` + `curl` 스모크. 기존 파일에 pre-existing tsc/lint 에러 있음 — **변경 파일 관련 에러만 없으면 됨**.
- vm5 접속 env는 서버 전용 — **`NEXT_PUBLIC_` 접두사 금지**.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- 작업 브랜치: `feat/external-scores-api` (이미 생성됨).
- CORS 헤더 없음 (서버→서버 소비자).

## File Structure

- **Create** `app/lib/aiDb.ts` — vm5 데이터 접근 계층. 책임: vm5 PostgREST GET 헬퍼, active base 버전(캐시), `fetchSceneTimeline(tmdbId)` 조립. HTTP/인증 개념 없음.
- **Create** `app/api/movies/[tmdb_id]/scores/route.ts` — HTTP 계층. 책임: `X-API-Key` 인증, `tmdb_id` 검증, `fetchSceneTimeline` 호출 결과를 상태코드(200/400/401/404/502)로 매핑.
- **Modify** `.env.example` — `AI_DATABASE_URL` / `AI_DATABASE_KEY` / `SCORES_API_KEY` 주석 추가.

---

### Task 1: vm5 데이터 접근 계층 (`app/lib/aiDb.ts`)

**Files:**
- Create: `4K_FE/app/lib/aiDb.ts`

**Interfaces:**
- Consumes: 없음 (env `AI_DATABASE_URL`, `AI_DATABASE_KEY`).
- Produces:
  - `export interface ScoresResponse { tmdb_id: number; model_version: string; length: number; arousal: number[]; valence: (number | null)[]; progress_ratio: number[]; }`
  - `export type TimelineResult = { kind: 'ok'; data: ScoresResponse } | { kind: 'not_found' } | { kind: 'upstream_error' };`
  - `export async function fetchSceneTimeline(tmdbId: number): Promise<TimelineResult>`
  - `export async function getActiveBaseVersion(): Promise<string>`

- [ ] **Step 1: 파일 작성**

`4K_FE/app/lib/aiDb.ts` 전체:

```ts
// vm5(AI DB) 직접 접근 — scene_scores 원본 타임라인 조회 전용 (서버 사이드만).
// FE의 SUPABASE_URL(vm4, data.peakly.art)와 별개. ML 파이프라인 db.py의
// _ai_headers(apikey + Bearer) 패턴 재사용. NEXT_PUBLIC_ 없음 → 브라우저 비노출.

const AI_DATABASE_URL = process.env.AI_DATABASE_URL || 'https://ai.peakly.art';
const AI_DATABASE_KEY = process.env.AI_DATABASE_KEY || '';

function aiHeaders(): Record<string, string> {
  return { apikey: AI_DATABASE_KEY, Authorization: `Bearer ${AI_DATABASE_KEY}` };
}

// vm5 PostgREST GET — 실패(비 2xx/네트워크) 시 throw.
async function aiGet<T>(table: string, params: Record<string, string>): Promise<T[]> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${AI_DATABASE_URL}/rest/v1/${table}?${qs}`, {
    headers: aiHeaders(),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`vm5 ${table} ${res.status}`);
  return (await res.json()) as T[];
}

// 활성 base 모델 버전 — vm5 model_versions.active=true 중 '::' 없는 버전.
// 모듈 레벨 1회 캐시. 실패/없음 시 폴백 'roberta-va-v1'.
let _activeBaseVersion: string | null = null;
export async function getActiveBaseVersion(): Promise<string> {
  if (_activeBaseVersion) return _activeBaseVersion;
  try {
    const rows = await aiGet<{ model_version: string }>('model_versions', {
      select: 'model_version',
      active: 'eq.true',
    });
    for (const r of rows) {
      if (r.model_version && !r.model_version.includes('::')) {
        _activeBaseVersion = r.model_version;
        return _activeBaseVersion;
      }
    }
  } catch {
    /* 폴백으로 진행 */
  }
  _activeBaseVersion = 'roberta-va-v1';
  return _activeBaseVersion;
}

export interface ScoresResponse {
  tmdb_id: number;
  model_version: string;
  length: number;
  arousal: number[];
  valence: (number | null)[];
  progress_ratio: number[];
}

export type TimelineResult =
  | { kind: 'ok'; data: ScoresResponse }
  | { kind: 'not_found' }
  | { kind: 'upstream_error' };

interface SceneRow {
  id: number;
  scene_index: number;
  progress_ratio: number;
}

interface ScoreRow {
  scenes_id: number;
  score: number;
  model_version: string;
}

// tmdb_id의 원본 scene_scores 타임라인을 scene_index 순으로 조립.
// - subtitles에 tmdb_id 없음 → not_found (404)
// - 영화는 있으나 점수 없음 → ok, 빈 배열(length 0)
// - vm5 조회 실패 → upstream_error (502)
export async function fetchSceneTimeline(tmdbId: number): Promise<TimelineResult> {
  try {
    const av = await getActiveBaseVersion();

    // 1) scenes (subtitles 임베드 필터 + scene_index 정렬)
    const scenes = await aiGet<SceneRow>('scenes', {
      select: 'id,scene_index,progress_ratio,subtitles!inner(tmdb_id)',
      'subtitles.tmdb_id': `eq.${tmdbId}`,
      order: 'scene_index.asc',
    });
    if (scenes.length === 0) return { kind: 'not_found' };

    // 2) scene_scores (해당 scene들의 av arousal/valence)
    const sceneIds = scenes.map((s) => s.id);
    const scores = await aiGet<ScoreRow>('scene_scores', {
      select: 'scenes_id,score,model_version',
      scenes_id: `in.(${sceneIds.join(',')})`,
      model_version: `in.(${av}::arousal,${av}::valence)`,
    });

    const arousalById = new Map<number, number>();
    const valenceById = new Map<number, number>();
    for (const row of scores) {
      if (row.model_version.endsWith('::arousal')) arousalById.set(row.scenes_id, row.score);
      else if (row.model_version.endsWith('::valence')) valenceById.set(row.scenes_id, row.score);
    }

    // 3) arousal 점수 있는 scene만 기준 타임라인 (scene_index 순서 유지)
    const arousal: number[] = [];
    const valence: (number | null)[] = [];
    const progress_ratio: number[] = [];
    for (const s of scenes) {
      const a = arousalById.get(s.id);
      if (a === undefined) continue;
      arousal.push(a);
      const v = valenceById.get(s.id);
      valence.push(v === undefined ? null : v);
      progress_ratio.push(s.progress_ratio);
    }

    return {
      kind: 'ok',
      data: {
        tmdb_id: tmdbId,
        model_version: av,
        length: arousal.length,
        arousal,
        valence,
        progress_ratio,
      },
    };
  } catch {
    return { kind: 'upstream_error' };
  }
}
```

> 주의: `URLSearchParams`가 `::`·`(`·`,` 를 퍼센트 인코딩하지만 PostgREST가 디코딩해 처리하므로 정상 동작한다. `subtitles!inner(tmdb_id)` 임베드는 응답에 `subtitles` 필드를 추가하지만 코드에서 사용하지 않는다(필터 용도).

- [ ] **Step 2: 타입 검사**

Run: `cd 4K_FE && npx tsc --noEmit 2>&1 | grep -i "app/lib/aiDb" || echo "NO aiDb ERRORS"`
Expected: `NO aiDb ERRORS` (이 파일 관련 타입 에러 없음. 다른 파일의 pre-existing 에러는 무시)

- [ ] **Step 3: 린트 (변경 파일만)**

Run: `cd 4K_FE && npx eslint app/lib/aiDb.ts`
Expected: 출력 없음 (exit 0, 클린)

- [ ] **Step 4: 커밋**

```bash
cd 4K_FE && git add app/lib/aiDb.ts
git commit -m "$(printf 'feat(api): vm5 scene_scores 접근 계층(aiDb) 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: 점수 API 라우트 + env 문서 (`route.ts`, `.env.example`)

**Files:**
- Create: `4K_FE/app/api/movies/[tmdb_id]/scores/route.ts`
- Modify: `4K_FE/.env.example`

**Interfaces:**
- Consumes: `fetchSceneTimeline(tmdbId: number): Promise<TimelineResult>` from `@/app/lib/aiDb` (Task 1).
- Produces: HTTP 엔드포인트 `GET /api/movies/[tmdb_id]/scores`. 응답 본문은 성공 시 `ScoresResponse`, 에러 시 `{ error: string }`.

- [ ] **Step 1: 라우트 파일 작성**

`4K_FE/app/api/movies/[tmdb_id]/scores/route.ts` 전체:

```ts
import { fetchSceneTimeline } from '@/app/lib/aiDb';

// 외부 점수 API — vm5 scene_scores 원본 타임라인 반환.
// 서버→서버 소비자, X-API-Key 인증. CORS 헤더 없음.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ tmdb_id: string }> }
) {
  // 1. 인증: X-API-Key == SCORES_API_KEY. 키 미설정 시에도 401(안전 기본값).
  const expected = process.env.SCORES_API_KEY;
  const provided = request.headers.get('x-api-key');
  if (!expected || provided !== expected) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 2. 검증: tmdb_id는 양의 정수.
  const { tmdb_id } = await params;
  const id = Number(tmdb_id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: 'invalid tmdb_id' }, { status: 400 });
  }

  // 3. 조회 → 상태코드 매핑.
  const result = await fetchSceneTimeline(id);
  if (result.kind === 'not_found') {
    return Response.json({ error: 'movie not found' }, { status: 404 });
  }
  if (result.kind === 'upstream_error') {
    return Response.json({ error: 'upstream error' }, { status: 502 });
  }
  return Response.json(result.data, { status: 200 });
}
```

- [ ] **Step 2: `.env.example`에 env 주석 추가**

`4K_FE/.env.example` 맨 끝에 아래 블록을 추가한다:

```
# 외부 점수 API — vm5(AI DB) 접속 (서버 전용, NEXT_PUBLIC_ 없음).
# 미설정 시 AI_DATABASE_URL은 https://ai.peakly.art 로 폴백.
# AI_DATABASE_URL=https://ai.peakly.art
# AI_DATABASE_KEY=<vm5 PostgREST key>
# 외부 호출자 인증 키 — 요청의 X-API-Key 헤더와 비교. 미설정 시 모든 요청 401.
# SCORES_API_KEY=<random secret>
```

- [ ] **Step 3: 타입 검사 + 빌드**

Run: `cd 4K_FE && npx tsc --noEmit 2>&1 | grep -iE "app/api/movies/\[tmdb_id\]/scores|app/lib/aiDb" || echo "NO NEW ERRORS"`
Expected: `NO NEW ERRORS`

Run: `cd 4K_FE && npm run build 2>&1 | tail -20`
Expected: 빌드 성공. 라우트 목록에 `/api/movies/[tmdb_id]/scores` 가 보이고 에러 없음.

- [ ] **Step 4: 린트 (변경 파일만)**

Run: `cd 4K_FE && npx eslint "app/api/movies/[tmdb_id]/scores/route.ts"`
Expected: 출력 없음 (exit 0, 클린)

- [ ] **Step 5: 인증/검증 스모크 테스트 (DB 불필요)**

`.env.local`에 `SCORES_API_KEY=testkey` 를 임시로 설정한 뒤 dev 서버를 띄운다:

```bash
cd 4K_FE && (grep -q '^SCORES_API_KEY=' .env.local 2>/dev/null || echo 'SCORES_API_KEY=testkey' >> .env.local)
npm run dev &   # 별도 셸에서 띄워도 됨. 준비될 때까지 대기.
```

준비되면 아래를 실행:

```bash
# (a) 키 없음 → 401
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/movies/27205/scores
# Expected: 401

# (b) 키 틀림 → 401
curl -s -o /dev/null -w "%{http_code}\n" -H "X-API-Key: wrong" http://localhost:3000/api/movies/27205/scores
# Expected: 401

# (c) 올바른 키 + 잘못된 tmdb_id → 400
curl -s -o /dev/null -w "%{http_code}\n" -H "X-API-Key: testkey" "http://localhost:3000/api/movies/abc/scores"
# Expected: 400
```

> (a)~(c)는 vm5 접속 없이 검증 가능하다. dev 서버는 확인 후 종료한다.

- [ ] **Step 6: (선택) 실데이터 스모크 — vm5 도달 가능 시에만**

`.env.local`에 `AI_DATABASE_KEY`(vm5 키)를 채우고 dev 서버를 띄운 뒤, 점수가 있는 실제 tmdb_id로:

```bash
curl -s -H "X-API-Key: testkey" "http://localhost:3000/api/movies/<REAL_TMDB_ID>/scores" | head -c 400
# Expected(점수 있음): {"tmdb_id":...,"model_version":"...","length":<N>,"arousal":[...],"valence":[...],"progress_ratio":[...]}
# Expected(영화 없음): HTTP 404 {"error":"movie not found"}
```

> vm5(AI DB)가 비어있거나 도달 불가하면 이 단계는 건너뛰고 빌드 성공으로 갈음한다. `.env.local`은 git 제외 대상이므로 커밋되지 않는다.

- [ ] **Step 7: 커밋**

```bash
cd 4K_FE && git add "app/api/movies/[tmdb_id]/scores/route.ts" .env.example
git commit -m "$(printf 'feat(api): GET /api/movies/[tmdb_id]/scores 외부 점수 API\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## 완료 후

- `superpowers:finishing-a-development-branch`로 main 머지/PR 여부 결정.
- push 거부 시 `git fetch origin && git rebase origin/main` 후 재push (원격 CI 봇 커밋 대비).
