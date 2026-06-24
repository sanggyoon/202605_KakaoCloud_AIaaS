# 맥미니 단독 이전(카카오 폐기) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> ⚠️ **이 작업은 `backup/macmini-migration` 브랜치 전용 — main 병합 금지.**

**Goal:** 카카오 폐기 후 맥미니 1대에서 FE+BE+단일 Supabase(svc/ai 스키마)+understand를 docker-compose로 자족 구동. 카카오 런타임 의존 0.

**Architecture:** 단일 Supabase(Postgres+pgvector+PostgREST+Kong, 스키마 svc·ai, 기본 svc)에 카카오 2개 DB를 1회 pg_dump 이전. FE/BE는 ai 접근 시에만 PostgREST profile 헤더(env `AI_SCHEMA`)를 추가(svc는 기본이라 무변경). Caddy가 3개 도메인 자동 TLS. 단일 루트 `.env`.

**Tech Stack:** docker-compose, Supabase self-host(공식 docker), PostgREST, Caddy, Next.js 16/FastAPI 이미지(재빌드).

## Global Constraints

- 브랜치 `backup/macmini-migration` 전용. **main 절대 병합 금지.**
- 도메인: FE `peakly.sanggyoon.com` / Supabase `peakly-data.sanggyoon.com` / understand `peakly-understand.sanggyoon.com`.
- 스키마: `PGRST_DB_SCHEMAS="svc, ai"`, 기본 `svc`. ai 접근만 `Accept-Profile: ai`(읽기)/`Content-Profile: ai`(쓰기).
- 스키마는 **env(`AI_SCHEMA`)로만** 주입 — 코드 하드코딩 금지(미설정 시 헤더 없음).
- 시크릿/키 전부 신규(JWT/anon/service/MANAGER). 카카오 값·도메인 런타임 참조 금지.
- 단일 루트 `.env`(gitignore) + `.env.example`. 배포 디렉토리: `deploy/macmini/`.
- 테스트 프레임워크 없음 → 검증: `tsc`/`npm run build`(FE), `python -m py_compile`(BE), `docker compose config`, 배포 후 수동 체크.

---

## Task 1: 앱 코드 — ai 스키마 profile 헤더 (env 기반, 하위호환)

**Files:**
- Modify: `4K_FE/app/lib/aiDb.ts`
- Modify: `4K_BE/app/main.py`

**Interfaces:**
- Produces: `AI_SCHEMA` env가 설정되면 ai PostgREST 호출에 profile 헤더가 붙는다(미설정 시 무변경).

- [ ] **Step 1: FE aiDb.ts — aiGet에 Accept-Profile 추가**

`4K_FE/app/lib/aiDb.ts`의 `aiHeaders`/`aiGet` 부분을 교체:

```ts
const AI_DATABASE_KEY = process.env.AI_DATABASE_KEY || '';
const AI_SCHEMA = process.env.AI_SCHEMA || '';

function aiHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    apikey: AI_DATABASE_KEY,
    Authorization: `Bearer ${AI_DATABASE_KEY}`,
  };
  // 단일 Supabase에서 ai를 별도 스키마로 둘 때만 profile 지정(미설정=기본 스키마).
  if (AI_SCHEMA) h['Accept-Profile'] = AI_SCHEMA; // aiGet은 읽기 전용
  return h;
}
```
(`aiGet` 본문은 그대로 — `headers: aiHeaders()` 사용.)

- [ ] **Step 2: FE 검증**

Run: `cd 4K_FE && npx tsc --noEmit && npx eslint app/lib/aiDb.ts`
Expected: 에러 없음.

- [ ] **Step 3: BE main.py — ai_headers 헬퍼 추가**

`4K_BE/app/main.py` 상단(상수부, `DATA_URL` 정의 부근)에 추가:

```python
AI_SCHEMA = os.getenv("AI_SCHEMA", "")

def ai_headers(write: bool = False) -> dict:
    """ai PostgREST 헤더. AI_SCHEMA 설정 시 profile 지정(읽기/쓰기 구분)."""
    key = os.getenv("AI_DATABASE_KEY", "")
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    if AI_SCHEMA:
        h["Content-Profile" if write else "Accept-Profile"] = AI_SCHEMA
    return h
```

- [ ] **Step 4: BE main.py — ai 호출의 인라인 헤더를 ai_headers()로 교체**

main.py에서 `AI_DATABASE_URL`을 쓰는 각 블록의 인라인 헤더
`{"apikey": key, "Authorization": f"Bearer {key}"}` 를 `ai_headers()`(GET) 또는
`ai_headers(write=True)`(POST/PATCH/DELETE)로 교체한다. 대상(메서드):
- 모델/조회 GET: `model_versions`(~250), `processing_status`(~277 GET), `subtitles`(~282),
  `scenes`(~290), `scene_scores`(~297), active-model(~483), scores detail(~511) → `ai_headers()`
- ai 쓰기: `processing_status` **POST**(~401) → `ai_headers(write=True)`
> `DATA_URL`(svc) 호출의 `sb_headers()`는 기본 스키마라 **변경하지 않는다.**

- [ ] **Step 5: BE 검증**

Run: `cd 4K_BE && python -m py_compile app/main.py && echo OK`
Expected: `OK`. (가능하면 `grep -n "AI_DATABASE_URL" app/main.py`로 모든 ai 블록이 ai_headers 사용인지 육안 확인.)

- [ ] **Step 6: 커밋**

```bash
git add 4K_FE/app/lib/aiDb.ts 4K_BE/app/main.py
git commit -m "feat(backup): ai PostgREST profile 헤더(env AI_SCHEMA, 하위호환)"
```

---

## Task 2: 배포 스택 — compose + Caddy + .env (Supabase 기반)

**Files:**
- Create: `deploy/macmini/docker-compose.yml`
- Create: `deploy/macmini/Caddyfile`
- Create: `deploy/macmini/.env.example`
- Create: `deploy/macmini/.gitignore` (`.env`)
- Create: `deploy/macmini/README.md`

**Interfaces:**
- Produces: `docker compose -f deploy/macmini/docker-compose.yml up -d` 로 전체 스택 기동.

- [ ] **Step 1: Supabase self-host 베이스 준비**

공식 supabase docker를 베이스로 사용(롤/JWT/PostgREST/Kong 자동). `deploy/macmini/`에서:
```bash
# supabase 공식 docker 디렉토리에서 docker-compose.yml + volumes + kong.yml 가져오기
# (또는 supabase/docker 의 compose를 베이스로 .env 구성)
```
구성 변경점:
- `db`: 이미지에 pgvector 포함(supabase/postgres 기본 포함). 스키마 svc·ai는 Task 3에서 생성.
- `rest`(PostgREST) env: `PGRST_DB_SCHEMAS="svc, ai"` (기본=svc).
- 불필요 컴포넌트 비활성: auth/realtime/storage/imgproxy/analytics/functions/vector
  (카카오 values-data와 동일 정책). studio는 선택(basic auth 뒤).

- [ ] **Step 2: 앱 서비스 + understand + caddy 추가**

`deploy/macmini/docker-compose.yml`에 서비스 추가(요지):

```yaml
  frontend:
    build:
      context: ../../4K_FE
      args:
        NEXT_PUBLIC_SUPABASE_URL: ${NEXT_PUBLIC_SUPABASE_URL}
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}
    env_file: [.env]
    environment:
      BE_INTERNAL_URL: "http://backend:8000"
    expose: ["3000"]
    restart: unless-stopped

  backend:
    build: { context: ../../4K_BE }
    env_file: [.env]
    environment:
      DATA_SUPABASE_URL: "http://kong:8000"
      AI_DATABASE_URL: "http://kong:8000"
      AI_SCHEMA: "ai"
    expose: ["8000"]
    restart: unless-stopped

  understand:
    build: { context: ../../understand-dashboard }
    expose: ["80"]
    restart: unless-stopped

  caddy:
    image: caddy:2
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    depends_on: [frontend, kong, understand]
    restart: unless-stopped
```
> `kong`은 supabase 베이스의 게이트웨이(8000). FE 브라우저용 anon 키와 svc/ai 스키마를 라우팅.

- [ ] **Step 3: Caddyfile (자동 TLS, 3 도메인)**

`deploy/macmini/Caddyfile`:
```
peakly.sanggyoon.com {
    reverse_proxy frontend:3000
}
peakly-data.sanggyoon.com {
    reverse_proxy kong:8000
}
peakly-understand.sanggyoon.com {
    reverse_proxy understand:80
}
```

- [ ] **Step 4: .env.example (단일, 키 이름만)**

`deploy/macmini/.env.example`:
```
# 도메인
NEXT_PUBLIC_SUPABASE_URL=https://peakly-data.sanggyoon.com
NEXT_PUBLIC_SUPABASE_ANON_KEY=
# Supabase 코어
POSTGRES_PASSWORD=
JWT_SECRET=
ANON_KEY=
SERVICE_ROLE_KEY=
# 앱(BE)
DATA_SUPABASE_KEY=        # = SERVICE_ROLE_KEY
AI_DATABASE_KEY=          # = SERVICE_ROLE_KEY
AI_SCHEMA=ai
TMDB_API_KEY=             # 선택(메타 갱신 안 쓰면 비움)
# 매니저(신규 강한 값)
MANAGER_ID=admin
MANAGER_PASSWORD=
MANAGER_SESSION_SECRET=
```
`deploy/macmini/.gitignore` 에 `.env` 추가.

- [ ] **Step 5: compose 문법 검증 + 커밋**

Run: `cd deploy/macmini && cp .env.example .env && docker compose config >/dev/null && echo "compose ok"`
Expected: `compose ok` (값 채우기 전 문법만). 이후 `.env`는 커밋 금지.
```bash
git add deploy/macmini/docker-compose.yml deploy/macmini/Caddyfile deploy/macmini/.env.example deploy/macmini/.gitignore deploy/macmini/README.md
git commit -m "feat(backup): 맥미니 docker-compose 스택(supabase+FE+BE+understand+caddy)"
```

---

## Task 3: 데이터 마이그레이션 (카카오 → 맥미니, 1회)

**Files:**
- Create: `deploy/macmini/migrate/dump-from-kakao.sh`
- Create: `deploy/macmini/migrate/load-into-schemas.sh`
- Create: `deploy/macmini/migrate/grants.sql`

**Interfaces:**
- Produces: 맥미니 Supabase Postgres에 `svc`(=카카오 data), `ai`(=카카오 ai) 스키마 적재 완료.

- [ ] **Step 1: 카카오에서 덤프 (가동 중 1회)**

`deploy/macmini/migrate/dump-from-kakao.sh` — 카카오 두 DB를 각각 덤프(스키마+데이터+함수+RLS):
```bash
#!/usr/bin/env bash
set -euo pipefail
# 카카오 data DB (public) → data.dump
pg_dump "$KAKAO_DATA_DSN" --schema=public --no-owner --no-privileges -Fc -f data.dump
# 카카오 ai DB (public) → ai.dump
pg_dump "$KAKAO_AI_DSN"   --schema=public --no-owner --no-privileges -Fc -f ai.dump
```
> 카카오 Postgres에 직접 접속(포트포워딩/psql) DSN 필요. pgvector 확장은 대상에서 미리 생성.

- [ ] **Step 2: 맥미니에 스키마로 적재 (public → svc/ai rename)**

`deploy/macmini/migrate/load-into-schemas.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
DB="$MACMINI_DSN"   # 맥미니 supabase postgres
psql "$DB" -c "CREATE EXTENSION IF NOT EXISTS vector;"
# data.dump → 임시 복원 후 public→svc rename
psql "$DB" -c "DROP SCHEMA IF EXISTS svc CASCADE; CREATE SCHEMA svc;"
pg_restore --no-owner --no-privileges -d "$DB" --schema=public data.dump || true
psql "$DB" -c "ALTER SCHEMA public RENAME TO svc_tmp; ALTER SCHEMA svc RENAME TO public_tmp; ALTER SCHEMA svc_tmp RENAME TO svc; ALTER SCHEMA public_tmp RENAME TO public;" 2>/dev/null || true
```
> 실제 rename은 환경에 따라 까다로움 — **권장 절차**: data.dump를 **빈 임시 DB**에 복원 →
> `ALTER SCHEMA public RENAME TO svc` → `pg_dump -n svc` → 맥미니 본 DB에 적재. ai도 동일(`ai`).
> (구현 시 임시 DB 방식으로 확정 — 본 DB의 public을 건드리지 않음.)

- [ ] **Step 3: 롤/권한/검색경로 (grants.sql)**

`deploy/macmini/migrate/grants.sql`:
```sql
-- Supabase 기본 롤에 svc/ai 스키마 접근 부여 (service_role은 BYPASSRLS)
GRANT USAGE ON SCHEMA svc, ai TO anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA svc TO anon, authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA ai  TO anon, authenticated;
GRANT ALL    ON ALL TABLES IN SCHEMA svc, ai TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA svc TO anon, authenticated, service_role;
-- SECURITY DEFINER 함수 search_path가 svc를 보게 (필요 시)
-- ALTER FUNCTION svc.validate_api_key(text) SET search_path = svc;
-- ALTER FUNCTION svc.find_preferred_movies(...) SET search_path = svc;
```
> RLS 정책은 덤프에 포함되어 svc로 따라옴(api_keys/visits anon 차단 유지). 적용 후 확인.

- [ ] **Step 4: 커밋**

```bash
git add deploy/macmini/migrate/
git commit -m "feat(backup): 데이터 마이그레이션 스크립트(카카오→svc/ai 스키마, grants)"
```

---

## Task 4: 신규 키 발급 + 배포 + 검증 (운영 — 맥미니에서)

**Files:**
- Modify: `deploy/macmini/README.md` (런북 보강)

- [ ] **Step 1: 신규 JWT/키 생성**

```bash
JWT_SECRET=$(openssl rand -hex 32)
# anon/service 키는 이 JWT_SECRET으로 서명한 JWT — supabase의 키 생성 방식(jwt.io 또는 스크립트)
```
→ `.env`에 `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`(=DATA/AI key), `NEXT_PUBLIC_SUPABASE_ANON_KEY`(=ANON_KEY), `MANAGER_*`(강한 값), `POSTGRES_PASSWORD` 채움.

- [ ] **Step 2: DNS — 3개 A레코드 → 맥미니 공인 IP**

`peakly` / `peakly-data` / `peakly-understand` `.sanggyoon.com` → 맥미니 IP. (Caddy 자동 TLS는 80/443 도달 필요.)

- [ ] **Step 3: 기동 + 마이그레이션**

```bash
cd deploy/macmini
docker compose up -d db rest kong          # Supabase 코어 먼저
# migrate/ 실행: dump-from-kakao(카카오) → load-into-schemas → psql -f grants.sql
docker compose up -d --build               # FE(빌드)·BE·understand·caddy
docker compose ps                          # 전부 healthy
```

- [ ] **Step 4: 검증 (카카오 의존 0 확인)**

```bash
# 공개 읽기(svc)
curl -s -o /dev/null -w "movies %{http_code}\n" -H "apikey:$ANON_KEY" "https://peakly-data.sanggyoon.com/rest/v1/movies?select=tmdb_id&limit=1"
# ai(스키마 헤더)
curl -s -o /dev/null -w "scenes %{http_code}\n" -H "apikey:$ANON_KEY" -H "Accept-Profile: ai" "https://peakly-data.sanggyoon.com/rest/v1/scene_scores?select=id&limit=1"
# RLS: 민감 테이블 차단
curl -s -H "apikey:$ANON_KEY" "https://peakly-data.sanggyoon.com/rest/v1/api_keys?select=*&limit=1"   # [] 여야
```
- 브라우저 `https://peakly.sanggyoon.com` 대시보드 로드(svc), 영화 클릭 시 스코어/상세(ai) 정상.
- 매니저 로그인(새 비번), `https://peakly-understand.sanggyoon.com` 표시.
- **카카오를 꺼도(혹은 차단해도) 전부 동작.**

## 최종 점검

- [ ] `git log --oneline main..backup/macmini-migration` 로 커밋이 **이 브랜치에만** 있는지(main 미오염) 확인.
- [ ] `.env`가 커밋 안 됐는지(`git status`) 확인.
- [ ] 카카오 폐기 전 마이그레이션·검증 완료.

## 배포/운영 메모

- main 병합 금지. 원격 보관은 `git push -u origin backup/macmini-migration`(별도 브랜치)만.
- supabase studio가 필요하면 별 서비스로 추가하고 Caddy + basic auth 뒤에 둘 것.
- 정기 백업: 맥미니 Postgres `pg_dump` 크론(선택, 후속).
