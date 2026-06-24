# 맥미니 단독 이전(카카오 폐기) 설계 — 최소 서비스 자족 환경

작성일: 2026-06-24
상태: 설계 승인됨

## 목적

카카오클라우드(K3s)를 **폐기**하고, 백업한 소스로 **개인 맥미니 1대에서 최소 서비스**를
제공한다. DR/이중화가 아니라 **유일 환경으로의 이전**이며, **카카오에 대한 런타임 의존이 0**
이어야 한다(완전 독립).

제공 범위: 프론트(Next.js) + 백엔드(FastAPI) + 서비스/AI DB(단일 Supabase) + understand 대시보드.
제외: ML 파이프라인, cron, CI/CD, Grafana, ArgoCD, Argo Workflows, Terraform, WireGuard, AWS.

## 배경 / 확정 사실

- 기존 자산: `aws/docker-compose.yml`(FE+BE DR 스택), `aws/DR-DB-RUNBOOK.md`(논리복제 DR) —
  **이번엔 논리복제 대신 1회성 `pg_dump` 스냅샷**으로 단순화(백업 이전엔 스냅샷이 적합).
- FE는 `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`를 **빌드타임에 번들로 inline**(`4K_FE/Dockerfile` ARG).
  → 새 DB 도메인/키로 **FE 재빌드 필요**.
- 현재 DB는 2개(카카오 vm4 data, vm5 ai), 각자 `public` 스키마. 테이블명 충돌 없음
  (data: movies/movie_vectors/app_config/api_keys/visits, ai: scene_scores/scenes/subtitles/model_versions).
- 앱의 DB 접근: FE 브라우저 → `data` PostgREST(`/rest/v1`, anon 키), 서버사이드 → `ai` PostgREST.
  RPC: `find_preferred_movies`, `validate_api_key`(둘 다 data, SECURITY DEFINER).
- 보안(이전 작업): data DB RLS 적용됨 → 덤프에 RLS 정책 포함되어 이전됨.

## 결정 사항

| 항목 | 결정 |
|---|---|
| 호스트 | 맥미니 1대, docker-compose |
| DB | **단일 Supabase self-host**(Postgres+pgvector, PostgREST, Kong). studio는 선택(basic auth) |
| 스키마 | **svc + ai 명명 스키마**, `PGRST_DB_SCHEMAS="svc, ai"`, **기본=svc** |
| 스키마 선택 | **env 주입**(`DATA_SCHEMA`/`AI_SCHEMA`). 기본 svc라 data 호출은 헤더 불필요, **ai 호출만** `Accept-Profile`/`Content-Profile: ai` |
| 시크릿/키 | **전부 신규 생성**(JWT 시크릿, anon/service 키, MANAGER 비번/세션시크릿). 카카오 값 미사용 |
| FE | 재빌드: `NEXT_PUBLIC_SUPABASE_URL=https://peakly-data.sanggyoon.com` + 새 anon 키 |
| 도메인 | FE `peakly.sanggyoon.com` / Supabase `peakly-data.sanggyoon.com` / understand `peakly-understand.sanggyoon.com` |
| TLS | Caddy 자동(Let's Encrypt) |
| 마이그레이션 | 1회 `pg_dump`(카카오 가동 중) → 맥미니 svc/ai 스키마 restore |
| env 관리 | **단일 루트 `.env`** 하나로 전 서비스 런타임 + FE 빌드 인자(`build.args`) 일괄. gitignore |
| 범위 밖 | ML·cron·CI/CD·Grafana·ArgoCD·Argo·Terraform·WireGuard·AWS, 카카오 매니페스트 정리 |

## 핵심 개념 (왜 이렇게)

- **완전 독립:** 런타임 설정·도메인·키 모두 맥미니/sanggyoon.com 기준. 카카오 도메인(peakly.art 등)·
  IP·시크릿을 참조하지 않는다. 마이그레이션만 카카오 가동 중 1회 수행 후 카카오 폐기.
- **단일 Supabase + 2스키마:** DB 1개로 운영 단순화. PostgREST 기본 스키마를 `svc`로 두어
  핫패스(영화 목록/RPC) 코드는 무변경, ai 접근만 profile 헤더 추가 → 변경 최소.
- **env 기반 스키마:** 스키마명을 하드코딩하지 않고 env로 주입 → 설정만으로 환경 전환 가능,
  코드 깔끔.
- **신규 시크릿:** 카카오 노출 이력(예: git에 있던 세션 시크릿)과 무관하게 새 값으로 출발.

## 상세 설계

### 컴포넌트 (docker-compose, 맥미니)

```
[브라우저] ─https─> caddy
   ├ peakly.sanggyoon.com            → frontend:3000
   ├ peakly-data.sanggyoon.com       → supabase-kong:8000 (/rest/v1, /rpc; apikey)
   └ peakly-understand.sanggyoon.com → understand:80 (정적)

[내부망]
 frontend ─(server)→ backend:8000, supabase-kong:8000(ai 스키마)
 backend  ─→ supabase-kong:8000 (svc/ai 스키마)
 supabase-kong → postgrest → postgres(pgvector; 스키마 svc, ai)
```

| 서비스 | 이미지/내용 | 공개 |
|---|---|---|
| **caddy** | reverse proxy, 자동 TLS, 3개 도메인 라우팅 | 443/80 |
| **postgres** | Supabase Postgres(pgvector). 스키마 svc·ai | 내부 |
| **postgrest** | `PGRST_DB_SCHEMAS="svc, ai"`, `PGRST_JWT_SECRET=<신규>` | 내부 |
| **kong** | Supabase 게이트웨이(/rest/v1, /rpc, apikey 검증) | peakly-data.sanggyoon.com |
| **(선택) studio/meta** | 관리 UI/메타. studio는 basic auth | (선택) |
| **frontend** | 4k-fe **재빌드**(새 URL/anon키) + ai profile 코드 | peakly.sanggyoon.com |
| **backend** | 4k-be **재빌드**(profile 코드). `DATA_SUPABASE_URL=AI_DATABASE_URL=http://kong:8000`, `AI_SCHEMA=ai`, 신규 service 키 | 내부 |
| **understand** | nginx로 `understand-dashboard/dist` 정적 서빙 | peakly-understand.sanggyoon.com |

### 앱 코드 변경 (env 기반 스키마)

- **공통 원칙:** PostgREST 호출 시, ai 대상이면 `Accept-Profile: ai`(GET/HEAD) /
  `Content-Profile: ai`(POST/PATCH/PUT/DELETE) 헤더 추가. svc(기본)는 헤더 없음.
- **FE:** `4K_FE/app/lib/aiDb.ts`의 `aiGet` 등 ai 호출에 `AI_SCHEMA` env가 있으면 profile 헤더.
  (data 호출 = `data.ts`/`apiKeys.ts`/`/api/movies` 라우트는 기본 스키마라 무변경.)
- **BE:** `4K_BE/app/tmdb_common.sb_headers()`는 svc(기본) 유지. ai 접근 함수(main.py의
  `AI_DATABASE_URL` 호출들)에 `AI_SCHEMA` 헤더 추가(헬퍼로 중앙화).
- env: 맥미니 `AI_SCHEMA=ai`(필요 시 `DATA_SCHEMA=svc`도). 미설정 시 헤더 없음.

### 데이터 마이그레이션 (1회, 카카오 가동 중)

1. 카카오에서 `pg_dump` — data DB, ai DB 각각(스키마+데이터+함수+RLS+pgvector).
2. 맥미니 Supabase Postgres에 **스키마로 분리 적재**: data → `svc`, ai → `ai`
   (덤프의 `public`을 대상 스키마로 rename/이식 — 구현 계획에서 정확한 절차).
3. **신규 롤/권한:** Supabase 기본 롤(anon/authenticated/service_role/authenticator)에
   svc·ai 스키마 `USAGE` + 테이블/함수 권한 부여. SECURITY DEFINER 함수의 search_path가
   새 스키마를 가리키게 확인.
4. **신규 JWT/키:** 새 JWT 시크릿으로 anon/service 키 발급 → FE 재빌드·BE env에 반영.
5. RLS 정책이 svc 스키마에 그대로 적용됐는지(api_keys/visits anon 차단) 확인.

### 시크릿/환경변수 관리 (단일 루트 .env)

- **루트 `.env` 하나**(gitignore)로 전부 관리. docker-compose가 이 파일로:
  - 런타임 주입(supabase/backend/understand/caddy) — `env_file:` 또는 `${VAR}` 치환.
  - **FE 빌드타임**(`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`) — `build.args`가 같은 `.env` 참조.
- 키 목록: `POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`,
  `DATA_SUPABASE_KEY`(=service), `AI_DATABASE_KEY`(=service), `MANAGER_ID/PASSWORD/SESSION_SECRET`,
  `TMDB_API_KEY`(선택), `AI_SCHEMA=ai`, 도메인 3종, `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`.
- 앱 코드(env 읽기)는 변경 불필요 — compose가 컨테이너 프로세스 env로 주입. 기존 흩어진
  env(`4K_BE/.env`, `4K_ML/.env`, `aws/.env`, k8s secret)는 떠날 환경 것이라 미사용.
- `.env.example`(키 이름만, 값 빈칸) 동봉.

## 검증

- **자족성:** 카카오가 완전히 꺼진(혹은 차단된) 상태에서 동작해야 한다.
- 브라우저 `https://peakly.sanggyoon.com` → 대시보드 영화 목록 로드(svc 스키마),
  무한스크롤·필터·검색 정상.
- 스코어 API `/api/movies/{id}/scores` → 200(ai 스키마, profile 헤더 경유).
- 매니저 로그인(새 비번) 성공, CRUD 동작.
- `https://peakly-understand.sanggyoon.com` 대시보드 표시.
- RLS: anon으로 api_keys/visits 조회 시 차단(빈/거부).
- 빌드/구동: `docker compose up -d` 후 전 컨테이너 healthy.

## 범위 밖 (YAGNI)

- 카카오 전용 자산 정리(Ansible k8s 매니페스트, `aws/terraform`, 모니터링 스택) — 백업 구동엔
  불필요. 별도 정리 가능.
- ML 학습/추론(KServe/Argo), cron(backfill/subtitle), CI/CD(GitHub Actions), Grafana/ArgoCD.
- 연속 복제·자동 페일오버(1회 스냅샷 이전으로 갈음).
- 외부 백업/스냅샷 자동화(필요 시 후속).
