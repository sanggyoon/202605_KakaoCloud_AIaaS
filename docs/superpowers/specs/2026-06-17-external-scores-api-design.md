# 외부 점수 API — `GET /api/movies/[tmdb_id]/scores`

작성일: 2026-06-17
상태: 설계 승인됨

## 목적

외부(서버→서버) 호출자에게 영화의 **원본 스코어링 타임라인**(scene별 raw
arousal/valence 점수)을 `X-API-Key` 인증으로 반환한다.

여기서 "원본"은 `movie_vectors`(전처리·스무딩·스케일링이 끝난 *가공* 벡터)가
아니라, vm5(AI DB)의 `scene_scores` 테이블에 들어있는 씬별 raw roberta 점수를
뜻한다. FE의 기존 `fetchVectorPair()`는 가공 벡터를 쓰므로 이 기능과 무관하다.

## 배경 / 제약

- 루트: `/Users/sanggyoon/Documents/KakaoCloud_Project`, 프론트는 `4K_FE/`
  (Next.js 16.2.5, App Router, Turbopack).
- `4K_FE/AGENTS.md`: 표준과 다른 커스텀 Next이므로 **코드 작성 전**
  `node_modules/next/dist/docs/`에서 라우트 핸들러 시그니처를 확인할 것.
- JS 테스트 러너 없음 → 검증은 `npx tsc --noEmit`, `npm run lint`(기존 파일에
  pre-existing 에러 있음 — 변경 파일만 깨끗하면 됨), `npm run build`.
- 소비자는 서버→서버 위주 → **CORS 헤더 불필요**.

## 데이터 구조 (확정 사실)

Peakly에는 DB가 둘 있다.

| | vm4 — 데이터 DB (`data.peakly.art`) | vm5 — AI DB (`ai.peakly.art`) |
|---|---|---|
| 내용 | `movies`, `movie_vectors`, `app_config` | `subtitles`, `scenes`, `scene_scores`, `model_versions` |
| 성격 | 가공 끝난 결과 | 원본 스코어링 |
| FE 연결 | 있음 (`app/lib/data.ts` `SUPABASE_URL`) | **없음** (매니저 페이지 하이퍼링크만) |

ML 파이프라인 흐름: vm5에서 `scene_scores`를 읽어(`AI_DATABASE_URL`) 가공한 뒤
vm4에 `movie_vectors`를 쓴다(`DATA_SUPABASE_URL`). 즉 `scene_scores`는
**vm5에만** 존재한다.

관련 스키마(`4K_ML/db/schema.sql`):

- `subtitles(id, tmdb_id unique, ...)`
- `scenes(id, subtitles_id FK→subtitles, scene_index, start_ms, end_ms,
  progress_ratio, ...)` — `unique(subtitles_id, scene_index)`
- `scene_scores(id, scenes_id FK→scenes, score double precision,
  model_version FK→model_versions)` — `unique(scenes_id, model_version)`,
  `model_version` 예: `roberta-va-v1::arousal` / `roberta-va-v1::valence`
- `model_versions(model_version PK, kind, active, ...)`

조회 체인: `subtitles(tmdb_id=X) → scenes(scene_index ASC) →
scene_scores(score, model_version in (av::arousal, av::valence))`.

참고 기존 쿼리: `4K_ML/generate_vectors/db.py`의 `fetch_axis_scores` /
`fetch_active_version` / `build_series`, `4K_ML/db/rpc_arousal_version_filter.sql`.

## 결정 사항

1. **데이터 소스**: vm5에 직접 연결 (BE 프록시·vm4 미러 아님).
2. **쿼리 방식**: 2-스텝 조회 (scenes → scene_scores). 서버 코드에서 병합·정렬.
3. **model_version**: vm5 `model_versions.active=true`(폴백 `roberta-va-v1`)를
   읽는 ML 방식(`fetch_active_version`)을 따른다. FE의 `getActiveVersion()`은
   vm4 미러라 부적합.
4. **응답 스키마**: 타임라인 메타 포함 병렬 배열.
5. **에러 처리**: 영화가 있으면(subtitles 존재) 점수가 없어도 200+빈 배열;
   subtitles 자체가 없으면 404.
6. **인증**: `X-API-Key` 헤더를 서버 env `SCORES_API_KEY`와 비교.

## 상세 설계

### 1. 라우트 & 인증

- 파일: `4K_FE/app/api/movies/[tmdb_id]/scores/route.ts` — App Router `GET`
  핸들러. 서버 사이드 실행, CORS 헤더 없음.
- 요청 헤더 `X-API-Key`를 서버 env `SCORES_API_KEY`와 비교.
  - 헤더 누락/불일치 → **401**.
  - env(`SCORES_API_KEY`) 미설정 시에도 모든 요청 → **401** (안전 기본값:
    키가 설정되지 않았으면 누구도 통과 못 함).

### 2. 데이터 소스 (vm5 직접)

- 서버 전용 env:
  - `AI_DATABASE_URL` — 폴백 `https://ai.peakly.art`
  - `AI_DATABASE_KEY` — vm5 PostgREST 호출용 키
- 헤더는 ML `db.py`의 `_ai_headers()` 패턴 재사용:
  `{ apikey: KEY, Authorization: "Bearer " + KEY }`.
- **NEXT_PUBLIC_ 접두사 없음** → 빌드 번들/브라우저에 노출되지 않음.

### 3. 흐름 (active version + 2-스텝)

1. **active version 조회** (모듈 레벨 1회 캐시):
   `GET {AI_DATABASE_URL}/rest/v1/model_versions?select=model_version&active=eq.true`
   응답에서 `::`가 없는 base 버전을 고른다. 실패/없음 시 폴백 `roberta-va-v1`.
   결과를 `av`라 한다.
2. **scenes 조회**:
   `GET {AI_DATABASE_URL}/rest/v1/scenes?select=id,scene_index,progress_ratio,start_ms,subtitles!inner(tmdb_id)&subtitles.tmdb_id=eq.{X}&order=scene_index.asc`
   - 0행 → subtitles에 해당 영화 없음 → **404**.
3. **scene_scores 조회**:
   `GET {AI_DATABASE_URL}/rest/v1/scene_scores?select=scenes_id,score,model_version&scenes_id=in.({ids})&model_version=in.({av}::arousal,{av}::valence)`
   - `ids`는 2단계에서 얻은 `scenes.id` 목록.
4. **서버 병합·정렬**:
   - `scenes_id → { arousal?, valence? }` 맵을 만든다.
   - 기준 타임라인 = **arousal 점수가 있는 scene**을 scene_index 순으로 정렬한 것.
   - 각 출력 배열(`arousal`/`valence`/`progress_ratio`/`start_ms`)을 그 순서대로
     채운다. 같은 scene에 valence 점수가 없으면 `valence` 배열의 해당 위치는
     `null`(정상 케이스에선 arousal/valence가 쌍으로 생성되어 발생하지 않음).

> scenes 건수는 단일 영화 기준 작으므로(보통 수백~수천 행) `scenes_id=in.(...)`
> 한 번으로 충분하다. 페이지네이션은 불필요.

### 4. 응답 (200)

```json
{
  "tmdb_id": 27205,
  "model_version": "roberta-va-v1",
  "length": 1280,
  "arousal": [0.12, 0.34, "..."],
  "valence": [-0.05, 0.21, "..."],
  "progress_ratio": [0.0, 0.0008, "..."],
  "start_ms": [0, 1200, "..."]
}
```

- `model_version`은 base 버전(`av`). 축 접미사(`::arousal`)는 붙이지 않는다.
- `length` = 기준 타임라인 길이 = `arousal` 배열 길이.
- 모든 배열은 동일 길이(`length`).
- 영화는 있으나(subtitles 존재) 해당 버전 점수가 아직 없음:
  → **200**, 모든 배열 `[]`, `length: 0`.

### 5. 에러 처리

| 코드 | 조건 |
|---|---|
| 400 | `tmdb_id`가 양의 정수가 아님 (형식 오류) |
| 401 | `X-API-Key` 누락/불일치, 또는 서버에 `SCORES_API_KEY` 미설정 |
| 404 | subtitles에 해당 `tmdb_id` 없음 |
| 200 | 정상 (점수 없으면 빈 배열, `length: 0`) |

- 에러 응답 본문은 `{ "error": "<message>" }` 형태의 JSON.
- vm5 조회 자체가 실패(네트워크/5xx)하면 → **502** (`{ "error": "upstream error" }`).

### 6. 환경 변수 (`.env.example` 주석 추가)

```
# 외부 점수 API — vm5(AI DB) 접속 (서버 전용, NEXT_PUBLIC_ 없음)
# AI_DATABASE_URL=https://ai.peakly.art
# AI_DATABASE_KEY=<vm5 PostgREST key>
# 외부 호출자 인증 키 (X-API-Key 헤더와 비교)
# SCORES_API_KEY=<random secret>
```

## 검증

- `npx tsc --noEmit`
- `npm run lint` (변경 파일만 클린이면 됨 — 기존 파일 pre-existing 에러 무시)
- `npm run build`
- 코드 작성 전 `node_modules/next/dist/docs/`로 라우트 핸들러 시그니처
  (특히 동적 세그먼트 `params` 형태) 확인.

## 범위 밖 (YAGNI)

- CORS 헤더 / OPTIONS 프리플라이트 (서버→서버 소비자).
- rate limiting, API 키 다중 발급/회전.
- movie_vectors(가공 벡터) 반환 — 기존 `fetchVectorPair`가 담당.
- vm5 RPC 함수 배포 — 2-스텝 REST로 충분.
