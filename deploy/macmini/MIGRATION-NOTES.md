# Peakly 백업·이전 기록 (카카오클라우드 → 맥미니 단독)

> 카카오클라우드(K3s) 폐기에 대비해, 백업한 소스로 **개인 맥미니 1대**에서 핵심 서비스를
> 자족 구동하도록 이전. DR(이중화)이 아니라 **유일 환경으로의 완전 이전**이며 카카오 런타임 의존 0.

- 작업 브랜치: `backup/macmini-migration` (⚠️ `main` 병합 금지 — 별도 보관)
- 결과: `peakly.sanggyoon.com` / `peakly-data.sanggyoon.com` / `peakly-understand.sanggyoon.com` 정상 동작
- 일자: 2026-06-24

---

## 1. 목표 & 범위

| 구분 | 내용 |
|---|---|
| **목적** | 카카오 폐기 후 맥미니에서 최소 서비스 제공, 카카오와 완전 독립 |
| **포함** | 프론트(Next.js) · 백엔드(FastAPI) · 서비스/AI DB(단일 Supabase) · understand 대시보드 |
| **제외** | ML 파이프라인, cron, CI/CD, Grafana, ArgoCD, Argo Workflows, Terraform, WireGuard |
| **독립성** | 신규 시크릿/키 전부 재발급, 런타임에 카카오 도메인·IP 참조 0 |

---

## 2. 최종 아키텍처

```
[브라우저] ──https──> nginx-proxy + acme-companion (기존, 자동 TLS, 네트워크 'proxy')
  peakly.sanggyoon.com            → frontend:3000   (Next.js)
  peakly-data.sanggyoon.com       → kong:8000       (Supabase API/Studio)
  peakly-understand.sanggyoon.com → understand:80   (정적 대시보드)

[내부 통신 — docker compose default 네트워크]
  frontend ─(server)→ backend:8000, kong:8000(ai 스키마)
  backend  ─→ kong:8000 (public 기본 / ai 는 Accept-Profile 헤더)
  kong → rest(PostgREST, PGRST_DB_SCHEMAS="public, ai") → db(Postgres17 + pgvector)
  studio → meta(postgres-meta) → db
```

### 컨테이너 구성
| 서비스 | 이미지 | 역할 |
|---|---|---|
| `supabase-db` | supabase/postgres:17.6.1.136 | Postgres + pgvector (public=서비스DB, ai=AI DB) |
| `supabase-rest` | postgrest:v14.12 | PostgREST (`public, ai` 스키마 노출, 기본 public) |
| `supabase-kong` | kong:3.9.1 | API 게이트웨이(/rest/v1, /rpc, apikey) + Studio 라우팅 |
| `supabase-studio` / `supabase-meta` | supabase/studio, postgres-meta | DB 관리 UI(+ 스키마 introspect) |
| `peakly-frontend` | peakly-frontend:latest | Next.js (NEXT_PUBLIC_SUPABASE_URL=peakly-data) |
| `peakly-backend` | peakly-backend:latest | FastAPI |
| `peakly-understand` | peakly-understand:latest | nginx 정적(understand-dashboard/dist) |

> TLS·라우팅은 맥미니에 **이미 돌던 nginx-proxy + acme-companion**을 재사용. 우리 컨테이너는
> `VIRTUAL_HOST` / `VIRTUAL_PORT` / `LETSENCRYPT_HOST` env + `proxy` 네트워크 합류만으로 자동 등록·인증서 발급.

---

## 3. 핵심 설계 결정

1. **단일 Supabase, 2개 스키마** — 카카오의 서비스DB·AI DB를 한 Postgres에 `public`(서비스) / `ai`(AI)로 통합.
   - PostgREST `PGRST_DB_SCHEMAS="public, ai"`, **기본 스키마 = public**.
   - 덕분에 data(영화 목록/RPC) 호출은 헤더 없이 그대로, **ai 호출만** `Accept-Profile: ai`.
2. **스키마 주입은 env로** — 코드에 스키마 하드코딩 금지(`AI_SCHEMA` env). 값 없으면 헤더 미부착(하위호환).
3. **신규 시크릿 전부 재발급** — JWT_SECRET / anon / service / MANAGER 비번·세션시크릿 모두 신규. 카카오 값 미사용.
4. **데이터는 1회 스냅샷 이전** — 연속 복제(논리복제) 대신 `pg_dump` 1회. 카카오 가동 중 캡처 후 폐기.
5. **단일 `.env`** — supabase self-host의 `.env`에 앱 키까지 합쳐 한 파일로 관리(`--env-file`로 공유).

---

## 4. 코드 변경 (앱)

ai DB를 별도 스키마(`ai`)로 두므로, PostgREST 호출 시 profile 헤더를 추가하도록 수정.
**env(`AI_SCHEMA`) 기반**이라 미설정 시 무변경(하위호환).

- **FE** `4K_FE/app/lib/aiDb.ts` — `aiHeaders()`에 `AI_SCHEMA` 있으면 `Accept-Profile` 추가(읽기 전용).
- **BE** `4K_BE/app/main.py` — `ai_headers(write)` 헬퍼 추가(읽기=`Accept-Profile`, 쓰기=`Content-Profile`), ai 호출부 5곳 교체.
- data(public, 기본 스키마) 호출은 무변경.

---

## 5. 마이그레이션 절차 (실제 수행)

### 5-1. 맥미니: Supabase self-host 준비
```bash
cd deploy/macmini
git clone --depth 1 https://github.com/supabase/supabase tmp && cp -r tmp/docker ./supabase && rm -rf tmp
cd supabase && cp .env.example .env
sh utils/generate-keys.sh      # POSTGRES_PASSWORD/JWT_SECRET/ANON_KEY/SERVICE_ROLE_KEY/DASHBOARD_PASSWORD 생성
sh utils/add-new-auth-keys.sh  # 신형 ES256 키
# API_EXTERNAL_URL / SUPABASE_PUBLIC_URL = https://peakly-data.sanggyoon.com, SITE_URL = https://peakly.sanggyoon.com
# 앱 키 추가: FE_DOMAIN/DATA_DOMAIN/UNDERSTAND_DOMAIN, NEXT_PUBLIC_SUPABASE_URL,
#            NEXT_PUBLIC_SUPABASE_ANON_KEY(=ANON_KEY), AI_SCHEMA=ai, MANAGER_ID/PASSWORD/SESSION_SECRET
docker compose --env-file .env up -d db   # Postgres 먼저
```

### 5-2. 노트북(kubectl): 카카오 덤프 → 맥미니 전송
> 노트북엔 Docker/pg_dump가 없어 **카카오 db 파드 안에서 직접 pg_dump 후 `kubectl cp`**.
```bash
# data DB (PG15)
kubectl -n data exec supabase-data-supabase-db-0 -- env PGPASSWORD='***' \
  pg_dump -h 127.0.0.1 -U postgres -d postgres --schema=public --no-owner --no-privileges -Fc -f /tmp/data.dump
kubectl -n data cp supabase-data-supabase-db-0:/tmp/data.dump ~/peakly-dumps/data.dump   # 11MB
# ai DB
kubectl -n ai exec supabase-ai-supabase-db-0 -- env PGPASSWORD='***' \
  pg_dump -h 127.0.0.1 -U postgres -d postgres --schema=public --no-owner --no-privileges -Fc -f /tmp/ai.dump
kubectl -n ai cp supabase-ai-supabase-db-0:/tmp/ai.dump ~/peakly-dumps/ai.dump           # 250MB
# 맥미니로 복사
scp ~/peakly-dumps/*.dump gimsang-gyun@192.168.0.4:~/Documents/peakly/deploy/macmini/migrate/
```

### 5-3. 맥미니: 스키마로 적재
> `deploy/macmini/migrate/load-macmini.sh` 한 번. 컨테이너 안에서:
> - **data → public** : 직접 `pg_restore`
> - **ai → ai 스키마** : 임시DB에 복원 → `ALTER SCHEMA public RENAME TO ai` → 그 스키마만 본 DB로
> - `grants-macmini.sql` : anon/authenticated/service_role 권한(RLS는 덤프에 포함되어 따라옴)
```bash
bash deploy/macmini/migrate/load-macmini.sh
# 결과: public 5 테이블(movies/movie_vectors/app_config/api_keys/visits), ai 6 테이블
```

### 5-4. 맥미니: 이미지 빌드 + 기동
```bash
bash deploy/macmini/build-images.sh    # peakly-frontend/backend/understand:latest
cd deploy/macmini/supabase
docker compose --env-file .env -f docker-compose.yml -f ../docker-compose.yml \
  up -d db rest kong meta studio frontend backend understand
```

### 5-5. DNS
- 맥미니는 **NAT 뒤**(공인 49.174.150.122 ≠ 로컬 192.168.0.4), 80/443 포트포워딩은 기존 사이트로 적용됨.
- `peakly` / `peakly-data` / `peakly-understand` `.sanggyoon.com` 를 기존 도메인과 동일 방식으로 **CNAME** 추가.

---

## 6. 트러블슈팅 (실제 막혔던 것들)

| 증상 | 원인 | 해결 |
|---|---|---|
| `docker pull` keychain 에러 (SSH) | macOS 로그인 키체인이 SSH 세션에서 잠김 | `security -v unlock-keychain ~/Library/Keychains/login.keychain-db` |
| heredoc `heredoc>`에서 멈춤 | 붙여넣기 시 `EOF`에 들여쓰기 들어가 종료 안 됨 | heredoc 대신 짧은 `echo … >> .env` 여러 줄 / 스크립트화 |
| 긴 빌드 명령 중간에 끊김 | CLI 붙여넣기에서 긴 한 줄이 줄바꿈됨 | `build-images.sh` 스크립트로 분리 |
| merged compose가 이미지 pull 시도 실패 | 빌드 컨텍스트 상대경로가 두 compose 디렉토리에서 충돌 | **이미지 사전 빌드** 후 compose는 `image:`만 참조 |
| `schema "public" already exists` (복원) | 덤프의 `CREATE SCHEMA public`이 기존 public과 충돌 | 무해(테이블은 정상 복원), 무시 |
| Studio "Failed to load schemas" | `meta`(postgres-meta) 미기동 | `docker compose up -d meta` |
| `peakly-data/manager` 404 | Studio는 **루트(`/`)**, `/manager`는 앱(peakly.sanggyoon.com)용 | 경로 구분(아래 운영 가이드) |
| data 스키마 rename 위험(pgvector/RPC) | 핫패스 스키마 rename은 타입충돌 위험 | **data=public**으로 단순화(rename은 ai만) |

---

## 7. 운영 가이드

### 접속 URL & 자격증명
| 용도 | URL | 자격증명 |
|---|---|---|
| 서비스(프론트) | `https://peakly.sanggyoon.com` | — |
| 앱 매니저 | `https://peakly.sanggyoon.com/manager` | `MANAGER_ID` / `MANAGER_PASSWORD` (`.env`) |
| Supabase Studio | `https://peakly-data.sanggyoon.com/` (루트) | `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` (`.env`) |
| understand | `https://peakly-understand.sanggyoon.com` | — |

> 모든 시크릿은 `deploy/macmini/supabase/.env` (gitignore). 분실 금지.

### 기동/재기동
```bash
cd ~/Documents/peakly/deploy/macmini/supabase
docker compose --env-file .env -f docker-compose.yml -f ../docker-compose.yml \
  up -d db rest kong meta studio frontend backend understand
# 상태
docker compose --env-file .env -f docker-compose.yml -f ../docker-compose.yml ps
```

### 코드/이미지 갱신
```bash
cd ~/Documents/peakly && git pull
bash deploy/macmini/build-images.sh
cd deploy/macmini/supabase && docker compose --env-file .env -f docker-compose.yml -f ../docker-compose.yml up -d
```

### 검증 체크
```bash
ANON=$(grep '^ANON_KEY=' .env | head -1 | cut -d= -f2-)
curl -s -o /dev/null -w "%{http_code}\n" -H "apikey: $ANON" "https://peakly-data.sanggyoon.com/rest/v1/movies?select=tmdb_id&limit=1"   # 200
curl -s -o /dev/null -w "%{http_code}\n" -H "apikey: $ANON" -H "Accept-Profile: ai" "https://peakly-data.sanggyoon.com/rest/v1/scene_scores?select=id&limit=1"  # 200
```

---

## 8. 향후 주의사항

- **데이터 스키마**: 서비스 데이터 = `public`, AI 데이터 = `ai`. ai 접근은 `Accept-Profile: ai` 필요(앱은 `AI_SCHEMA=ai`로 자동).
- **백업**: 맥미니 Postgres `pg_dump` 정기 크론 권장(현재 단발 스냅샷만).
- **SSH 세션 keychain**: docker 이미지 pull/build 전 키체인 잠금 풀려있어야 함.
- **main 병합 금지**: 이 작업은 `backup/macmini-migration` 브랜치 전용.
- **Studio 노출**: 공인 도메인에 basic auth로 노출 중. 비번은 32자 hex(충분)이나, 불필요 시 Kong dashboard 라우트 차단 가능.
