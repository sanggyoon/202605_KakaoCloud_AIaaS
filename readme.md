# Peakly — KakaoCloud AIaaS Project

영화의 **감정(arousal/valence) 곡선**을 분석해 "클라이맥스 그래프"와 벡터 유사도 기반 추천을 제공하는
서비스 **Peakly(4K Cinema)** 와 그 전체 인프라를 담은 모노레포. KakaoCloud VM 5대 위의 K3s 클러스터에서
GitOps(ArgoCD)로 운영하며, 자막 수집 → 감정 라벨링 → 벡터화 → 추천까지의 ML 파이프라인을 포함한다.

---

## 라이브 서비스

| 서비스 | URL | 인증 |
|---|---|---|
| Peakly (FE) | https://peakly.art | 공개 (매니저 페이지만 로그인) |
| Supabase **data** Studio/API | https://data.peakly.art | Basic Auth / anon·service 키 |
| Supabase **ai** API | https://ai.peakly.art | service 키(서버 전용) |
| Grafana | https://grafana.peakly.art | Grafana 인증 |
| ArgoCD | https://argocd.peakly.art | ArgoCD 인증 |

> 백업 환경(맥미니 단독)은 별도 브랜치 `backup/macmini-migration` 참조 — `peakly.sanggyoon.com`.

---

## 핵심 기능

- **영화 목록 / 무한 스크롤** — 최신순·오래된순 토글, 필터·검색.
- **클라이맥스 그래프** — 영화별 장면 감정 점수(arousal) 타임라인 시각화.
- **벡터 추천** — pgvector 코사인 유사도(`find_preferred_movies` RPC)로 취향 기반 추천.
- **점수 API** — 외부 고객용 `/api/movies/{tmdb_id}/scores` (API 키 인증, RLS).
- **매니저 콘솔** — 영화/자막/모델 버전/방문 통계 관리(`/manager`, 세션 로그인 + agami CAPTCHA 테스트).

---

## 아키텍처 & 데이터 흐름

```
            ┌────────────────────────── 브라우저 ──────────────────────────┐
            │                                                              │
   (A) anon 직접 읽기            (B) Next 서버 경유            (C) 매니저/쓰기
   /rest/v1 (RLS)                /api/movies (캐시)           /api/manager/*
            │                          │                          │
            ▼                          ▼                          ▼
   Supabase data            Next.js route handler        Next route → FastAPI(BE)
   (PostgREST, anon)        (unstable_cache) → data       → data/ai DB
                                                          │
   (D) 서버 전용: aiDb.ts (service key) ─────────────────→ Supabase ai (점수)
```

- **(A) 브라우저 → Supabase 직접**: 일부 공개 읽기(영화 상세, 누락분 보강)는 빌드타임에 baked된 anon 키로
  PostgREST를 직접 호출. **RLS**가 행 단위 접근을 통제(민감 테이블 `api_keys`/`visits`는 anon 차단).
- **(B) 브라우저 → Next 서버 → DB**: 메인 영화 목록(`/api/movies`)은 Next route handler가 `unstable_cache`로
  캐싱해 DB 부하를 줄여 반환.
- **(C) 매니저/쓰기**: `/api/manager/*` route가 세션 인증 후 FastAPI(`BE_INTERNAL_URL`)로 프록시 → DB 변경.
- **(D) 점수/AI**: `app/lib/aiDb.ts`가 **서버 전용** service 키로 ai DB(점수) 조회 — 키는 브라우저 미노출.

> Next.js는 풀스택. `page.tsx`/`'use client'` = 프론트(브라우저), `route.ts`/서버 컴포넌트/`proxy.ts` =
> 서버사이드. 별도 FastAPI가 본 백엔드이고, `4K_FE`의 route handler는 그 앞단 BFF(Backend-for-Frontend).

---

## 기술 스택

| 계층 | 기술 |
|---|---|
| Frontend | Next.js 16 (App Router), TypeScript, `unstable_cache` |
| Backend | FastAPI, Python 3.11, Uvicorn |
| Database | Supabase 2종(PostgreSQL + pgvector + PostgREST + Kong), RLS |
| ML | RoBERTa 기반 arousal/valence 회귀, pgvector 임베딩, KServe 서빙 |
| Infra | KakaoCloud VM × 5, K3s v1.30, Ansible, Helm |
| CI | GitHub Actions → GHCR (`ghcr.io/sanggyoon`) |
| CD | ArgoCD (GitOps) + Kustomize |
| Batch/Orchestration | Argo Workflows, CronJob (자막 수집·backfill) |
| Monitoring | Prometheus, Grafana, Loki/Promtail |
| TLS | cert-manager + Let's Encrypt |

---

## 저장소 구조

```
KakaoCloud_Project/
├── .github/workflows/
│   ├── deploy-4k-fe.yml         # FE CI/CD (4K_FE/** 변경 시)
│   ├── deploy-4k-be.yml         # BE CI/CD (4K_BE/** 변경 시)
│   └── deploy-4k-ml.yml         # ML CI/CD
├── 4K_FE/                       # Next.js 16 프론트엔드 (+ BFF route handlers)
│   ├── app/                     # App Router (page/route/components/lib)
│   │   ├── api/                 # route handlers (movies, manager/*, visit)
│   │   ├── lib/                 # data.ts·aiDb.ts·auth.ts·apiKeys.ts·captcha.ts
│   │   ├── login/ manager/ dashboard/ movie_list/
│   │   └── components/          # DetailOverlay, RandomModal 등
│   ├── proxy.ts                 # 미들웨어 인증 게이트(/manager·/api/manager)
│   └── Dockerfile
├── 4K_BE/                       # FastAPI 백엔드
│   └── app/                     # main.py, jobs.py, subtitle_collect.py, backfill_popular.py
├── 4K_ML/                       # ML 파이프라인
│   └── subtitle_parse/  labeling/  train/  generate_vectors/  serving/
├── Ansible/                     # 인프라 (IaC)
│   └── playbooks/  manifests/(ArgoCD 관리 K8s)  values/  helm-values/
├── understand-dashboard/        # 코드베이스 지식그래프 정적 대시보드(nginx)
├── loadtest/                    # k6 부하테스트 스크립트 + REPORT.md
├── aws/                         # AWS DR 청사진(terraform + docker-compose, 참고용)
└── docs/
    ├── db_script/               # schema.sql, rls_policies.sql, api_keys.sql, RPC 등
    ├── roberta-va-v2-rollout.md
    └── superpowers/             # specs/ · plans/ (설계·구현 계획 문서)
```

---

## 데이터베이스

2개의 Supabase 인스턴스로 분리:

- **data** (`data.peakly.art`) — 서비스 DB. 주요 테이블: `movies`, `movie_vectors`(pgvector),
  `app_config`, `api_keys`, `visits`. RPC: `find_preferred_movies`(벡터 검색), `validate_api_key`.
- **ai** (`ai.peakly.art`) — 점수/ML DB. `scene_scores`, `scenes`, `subtitles`, `dialogues`,
  `model_versions`, `processing_status`.

**보안(RLS):** anon 롤은 공개 테이블만 읽기, `api_keys`/`visits`는 차단. service_role은 RLS 우회(서버 전용).
스키마/정책은 `docs/db_script/`(특히 `rls_policies.sql`) 참고.

---

## ML 파이프라인 (`4K_ML/`)

자막 기반 장면 감정 점수를 산출해 추천 벡터를 만든다 (단계별 디렉토리):

1. **subtitle_parse** — 자막 수집/파싱 → 장면(scene) 분할.
2. **labeling** — 대사 기반 감정(arousal/valence) 라벨링.
3. **train** — RoBERTa 회귀 모델 학습(Argo Workflow).
4. **generate_vectors** — 영화별 감정 벡터 생성 → `movie_vectors`(pgvector).
5. **serving** — KServe로 추론 서빙, 활성 `model_version` 관리.

> 배치: 자막 수집·인기작 backfill은 CronJob(`4K_BE/app/subtitle_collect.py`, `backfill_popular.py`).
> 자막 실패 재시도는 7일 쿨다운.

---

## CI/CD

```
git push (main)
  → GitHub Actions: 경로별 트리거 → Docker 빌드 → GHCR push → kustomization.yaml 태그 커밋
  → ArgoCD: Git 변경 감지(~3분) → K3s 롤링 업데이트
```

- 트리거: `4K_FE/**` → `deploy-4k-fe.yml`, `4K_BE/**` → `deploy-4k-be.yml`, ML 동일.
- **FE 빌드 주의:** `NEXT_PUBLIC_*`(Supabase URL/anon, agami 사이트키)는 **빌드타임에 번들로 baked**.
  사이트키는 워크플로 `build-args`로 주입, 서버 시크릿(`AGAMI_SECRET` 등)은 K8s Secret으로 런타임 주입.

---

## 클러스터 구성

| VM | 역할 | Private IP | Public IP |
|---|---|---|---|
| vm1 | Control Plane + Ingress + NAT | 10.1.1.10 | 210.109.83.10 |
| vm2 | Worker (FE/BE) | 10.1.3.10 | - |
| vm3 | Worker (FE/BE) | 10.1.4.10 | - |
| vm4 | Worker (Data/DB) | 10.1.5.10 | - |
| vm5 | Worker (GPU/AI) — Tesla T4 | 10.1.7.10 | - |

NetworkPolicy(k3s kube-router)로 네임스페이스 간 트래픽 통제, ingress-nginx rate limit 적용.

---

## 보안 요약

- **RLS 활성** — anon 읽기 최소화, 민감 테이블 차단(`docs/db_script/rls_policies.sql`).
- **매니저 인증** — env 기반 ID/비밀번호, fail-closed(운영에서 미설정 시 인증 전면 거부),
  HMAC 서명·만료 세션 토큰(`4K_FE/app/lib/auth.ts`), 시크릿은 `frontend-secrets`.
- **CAPTCHA(테스트·비차단)** — 매니저 로그인에 agami 위젯(`captcha.ts`). 현재는 결과로 차단하지 않고
  실패 시 알림만(설계상 비차단, 코드에 `SECURITY(의도됨)` 주석).
- **rate limit** — `/api/visit` 등 비콘 스팸 차단.
- 취약점 점검 내역은 `SECURITY.md`(gitignore, 비공개).

---

## 백업 / DR

- **맥미니 단독 이전**(카카오 폐기 대비): 단일 Supabase(public/ai 스키마) + FE/BE + understand를
  docker-compose로 자족 구동. 브랜치 `backup/macmini-migration`, 기록은 그 브랜치의
  `deploy/macmini/MIGRATION-NOTES.md`. 도메인 `peakly*.sanggyoon.com`.
- **aws/** — AWS DR 청사진(terraform + docker-compose + `DR-DB-RUNBOOK.md`). 참고용.

---

## 로컬 개발

```bash
# 프론트엔드
cd 4K_FE && npm install
cp .env.example .env.local   # MANAGER_*, NEXT_PUBLIC_SUPABASE_*, (선택)AGAMI_* 채움
npm run dev                  # http://localhost:3000

# 백엔드
cd 4K_BE && pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

> `NEXT_PUBLIC_*` 변경 시 dev 서버 재시작 필요(빌드타임 inline). `AGAMI_SECRET` 미설정 시 캡챠 검증 스킵.

---

## 빠른 명령어

```bash
export KUBECONFIG=$(pwd)/Ansible/kubeconfig

kubectl get pods -A                                   # 전체 Pod
kubectl get applications -n argocd                    # ArgoCD 앱 상태
kubectl logs -n fe -l app=frontend --tail=50          # FE 로그
kubectl logs -n be -l app=backend --tail=50           # BE 로그

# 콘솔 비밀번호
kubectl get secret argocd-initial-admin-secret -n argocd -o jsonpath="{.data.password}" | base64 -d; echo
kubectl get secret kube-prometheus-stack-grafana -n monitoring -o jsonpath="{.data.admin-password}" | base64 -d; echo

# 부하 테스트(k6)
k6 run loadtest/peakly-rampup.js
```

---

## 문서

| 문서 | 내용 |
|---|---|
| `docs/db_script/` | 스키마·RLS 정책·API 키·RPC SQL |
| `docs/roberta-va-v2-rollout.md` | 감정 모델 v2 롤아웃 |
| `docs/superpowers/specs/` · `plans/` | 기능 설계 spec·구현 계획(캡챠, 백업 이전 등) |
| `loadtest/REPORT.md` | 1~5차 부하테스트 결과 정리 |
| `aws/DR-DB-RUNBOOK.md` | DB DR 절차 |
