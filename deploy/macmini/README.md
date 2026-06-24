# 맥미니 단독 스택 (카카오 폐기 후 유일 환경)

FE + BE + 단일 Supabase(svc/ai 스키마) + understand 를 docker-compose로 자족 구동.
카카오 런타임 의존 0. ⚠️ 이 작업은 `backup/macmini-migration` 브랜치 전용(main 병합 금지).

```
브라우저 ─https→ nginx-proxy + acme-companion (기존, 네트워크 'proxy', 자동 TLS)
  peakly.sanggyoon.com            → frontend:3000
  peakly-data.sanggyoon.com       → kong:8000 (Supabase /rest/v1, /rpc)
  peakly-understand.sanggyoon.com → understand:80
backend ─→ kong:8000 (svc 기본 / ai 는 Accept-Profile)
kong → rest(PostgREST, PGRST_DB_SCHEMAS="svc, ai") → db(Postgres+pgvector)
```
> TLS/라우팅은 **기존 nginx-proxy + acme-companion**이 담당. 우리 컨테이너는 `VIRTUAL_HOST`/
> `VIRTUAL_PORT`/`LETSENCRYPT_HOST` env + 네트워크 `proxy` 합류만 하면 자동 등록·인증서 발급.
> (Caddy·수동 nginx·certbot 불필요.)

## 0. 사전
- 맥미니: Docker + 기존 nginx-proxy(`proxy` 네트워크) 가동 중(다른 사이트와 공유).
- **NAT 뒤**(공인 49.174.150.122 ≠ 로컬 192.168.0.4). 80/443 포트포워딩은 기존 사이트로 이미 적용됨.
- DNS: `peakly` / `peakly-data` / `peakly-understand` `.sanggyoon.com` 를 **기존 도메인과 동일 방식**
  으로 추가 (고정 공인 IP면 A→49.174.150.122, DDNS 쓰면 그 호스트에 CNAME).

## 1. Supabase self-host 베이스 가져오기 (커밋 안 함, .gitignore됨)
```bash
cd deploy/macmini
git clone --depth 1 https://github.com/supabase/supabase tmp-supabase
cp -r tmp-supabase/docker ./supabase && rm -rf tmp-supabase
# 불필요 컴포넌트는 supabase/docker-compose.yml 에서 비활성(auth/realtime/storage/imgproxy/
# analytics/functions/vector) — 카카오 values-data 정책과 동일. db/rest/kong/(studio,meta)만 유지.
```

## 2. 단일 .env 작성
```bash
cp .env.example .env
# JWT_SECRET=$(openssl rand -hex 32)
# ANON_KEY / SERVICE_ROLE_KEY = 위 JWT_SECRET으로 서명(아래 키 생성 참고)
# NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY
# DATA_SUPABASE_KEY = AI_DATABASE_KEY = SERVICE_ROLE_KEY
# MANAGER_PASSWORD / MANAGER_SESSION_SECRET = 강한 신규 값
# POSTGRES_PASSWORD, DASHBOARD_* 채움
```
키 생성(anon/service JWT, JWT_SECRET 서명): Supabase 문서의 키 생성기 또는 스크립트 사용
(role=anon / role=service_role, iss=supabase). `.env`는 supabase와 **공유**(아래 --env-file).

## 3. Supabase 코어 기동
```bash
docker compose --env-file .env -f supabase/docker-compose.yml up -d db rest kong
```

## 4. 데이터 마이그레이션 (카카오 가동 중 1회)
`migrate/` 참고 (상세 절차 주석):
```bash
# (1) 카카오에서 덤프 — data DB / ai DB
KAKAO_DATA_DSN=... KAKAO_AI_DSN=... ./migrate/dump-from-kakao.sh
# (2) 맥미니 Postgres에 svc/ai 스키마로 적재 (public→svc / public→ai, 임시DB rename 방식)
MACMINI_DSN="postgresql://postgres:${POSTGRES_PASSWORD}@localhost:5432/postgres" ./migrate/load-into-schemas.sh
# (3) 롤/권한
psql "$MACMINI_DSN" -f migrate/grants.sql
```

## 5. 앱(빌드 포함) 기동
```bash
docker compose --env-file .env -f supabase/docker-compose.yml -f docker-compose.yml up -d --build
docker compose --env-file .env -f supabase/docker-compose.yml -f docker-compose.yml ps   # 전부 healthy
```

## 6. 검증 (카카오 의존 0)
```bash
ANON="$NEXT_PUBLIC_SUPABASE_ANON_KEY"; B=https://peakly-data.sanggyoon.com
curl -s -o /dev/null -w "movies(svc) %{http_code}\n" -H "apikey:$ANON" "$B/rest/v1/movies?select=tmdb_id&limit=1"
curl -s -o /dev/null -w "scenes(ai)  %{http_code}\n" -H "apikey:$ANON" -H "Accept-Profile: ai" "$B/rest/v1/scene_scores?select=id&limit=1"
curl -s -H "apikey:$ANON" "$B/rest/v1/api_keys?select=*&limit=1"   # RLS → [] 여야
```
- 브라우저 `https://peakly.sanggyoon.com` 대시보드 로드(svc), 영화 클릭 → 상세/스코어(ai) 정상.
- 매니저 로그인(새 비번), `https://peakly-understand.sanggyoon.com` 표시.
- **카카오를 차단/종료해도 전부 동작** → 자족 확인.

## 운영 메모
- 단일 .env 하나로 supabase compose(--env-file) + 앱 compose(env_file/치환) 공유.
- main 병합 금지. 원격 보관은 `git push -u origin backup/macmini-migration` 만.
- 정기 백업: 맥미니 Postgres `pg_dump` 크론(선택).
- studio가 필요하면 supabase studio + Caddy basic_auth 뒤로.
