# 하위 프로젝트 G — RoBERTa 점수 → movie_vectors 임베딩 설계

**작성일:** 2026-06-15
**범위:** `4K_ML/generate_vectors` 재작성(+Argo) / vm4 RPC 2개 SQL 수정 / FE 최소 변경.
**선행:** F(서빙·스코어링) 완료 — vm5 `scene_scores`에 `roberta-va-v1::arousal`·`::valence` 적재됨.
**관련 메모:** [[project_4k_ml_pipeline]] (이게 7단계 중 마지막)

---

## 1. 목표

vm5의 **씬 단위** RoBERTa 점수(`roberta-va-v1::arousal`/`::valence`)를 영화 단위 **타임라인 벡터**로 가공해 vm4 `movie_vectors`에 적재한다. 그러면 FE(곡선·지표·유사도)가 규칙기반 `rule-v1`이 아닌 **실제 모델 결과**로 동작한다.

핵심 산출: 영화 1편당 vm4 `movie_vectors` **두 행** —
- `roberta-va-v1::arousal` : 200차원 벡터, **z-score** (검색·곡선용)
- `roberta-va-v1::valence` : 200차원 벡터, **raw 0~1** (향후 색상용)

---

## 2. 핵심 결정 (브레인스토밍 확정)

| # | 결정 | 근거 |
|---|---|---|
| 1 | 두 축을 **별도 벡터 2행**으로 저장(합치지 않음) | 같은 [0,1] 그리드 정렬이라 FE가 인덱스로 zip(높이=arousal, 색=valence). 조회·버전·롤백 깔끔 |
| 2 | **arousal = z-score**, **valence = raw 0~1** | arousal은 pgvector 코사인 검색·FE 곡선에 쓰임 → 중심화 필요. valence는 색(절대 톤)이라 정규화 금지. 절대값 원본은 vm5 `scene_scores`에 보존 |
| 3 | 두 축 모두 **고정 [0,1] 그리드 200점** 리샘플 + savgol 스무딩 | 진행도 %가 실제 영화 진행도와 일치, 영화 간 시간 정렬(유사도 개선), 두 축 정렬 |
| 4 | 소스=**vm5**(ai REST, public), 타깃=**vm4** movie_vectors | vm5=실제 점수, vm4=서비스 DB |
| 5 | 실행=**Argo WorkflowTemplate** `generate-vectors` (GPU 불필요) | 다른 단계와 일관, CI 빌드→ArgoCD 배포→UI 실행 |
| 6 | `rule-v1` 행 **보존**(삭제 안 함) | 롤백·비교용. FE는 버전 필터로 roberta만 집음 |
| 7 | 유사 추천 = **arousal 0.7 + valence 0.3 가중결합** (실구현은 다음 FE sub-project) | 긴장 패턴 우선 + 정서 톤 보조. G는 두 벡터 제공으로 지원만 |

---

## 3. 데이터 흐름

```
vm5 (ai.peakly.art, public, apikey=AI_DATABASE_KEY)
  scene_scores (scenes_id, score, model_version ∈ {roberta-va-v1::arousal, ::valence})
  scenes       (id, subtitles_id, progress_ratio)
  subtitles    (id, tmdb_id)
        │  파이썬 조인: score → scene(progress) → subtitle(tmdb_id)
        ▼
  영화별 시계열:  arousal: [(progress, score)...]
                 valence: [(progress, score)...]
        │  처리(§4)
        ▼
vm4 (data.peakly.art, apikey=DATA_SUPABASE_KEY[, basic auth])
  movie_vectors upsert  (tmdb_id, vector, vector_version, normalization, smoothing_method)
        │
  movies.has_vector = true  (처리한 tmdb_id; §6)
vm5  processing_status.vector_state = done  (멱등 원장; §6)
```

- vm5 REST 패턴: 베이스 `https://ai.peakly.art`, 헤더 `apikey: <AI_DATABASE_KEY>`만(basic auth 불필요), public 스키마(`Accept-Profile` 불필요). 페이지네이션 limit/offset.
- vm4 쓰기: 기존 `vm4_upsert` 패턴 유지(`Prefer: resolution=merge-duplicates`, `on_conflict=tmdb_id,vector_version`). 기존 EXT 더미 경로는 제거.

---

## 4. 처리 (`process_axis`)

영화 1편, 한 축에 대해 `(progress_ratio, score)` 리스트 → 200차원 벡터.

공통(두 축 동일):
1. progress로 정렬.
2. **고정 [0,1] 그리드**: `x_new = np.linspace(0.0, 1.0, 200)`. `y = np.interp(x_new, x, scores)` (범위 밖은 양 끝 값으로 clamp).
3. **savgol 스무딩**: window=11(홀수, 데이터 길이보다 작게 보정), poly=2.
4. **씬 수 게이트**: 씬 < 5 이면 그 영화 스킵.

축별 마지막 단계(다름):
- **arousal**: z-score `(y - mean) / std`. `std < 1e-9`(평탄)면 **arousal 스킵 → 영화 스킵**(검색·곡선 불가). `normalization='zscore'`.
- **valence**: **그대로 0~1** (정규화 없음). 평탄해도 저장(중립 톤). `normalization='raw'`.

규칙: **arousal이 유효해야 그 영화를 적재.** arousal 유효 + valence 유효 → 두 행. arousal 유효하지만 valence 평탄/결측 → arousal 행만(색은 향후 중립 처리).

각 행 필드: `tmdb_id`, `vector`(list[float]), `vector_version`, `normalization`, `smoothing_method='savgol_w11_p2'`.

---

## 5. 실행 (Argo)

- `4K_ML/generate_vectors/generate_vectors.py`를 **깨끗한 CLI 배치**로 재작성: vm5 읽기 / vm4 쓰기, 전부 env 기반. EXT(외부 더미) 경로 삭제.
- 필요한 env(컨테이너): `AI_DATABASE_URL`, `AI_DATABASE_KEY`(vm5, 이미 `4k-ml-secrets`), `DATA_SUPABASE_URL`, `DATA_SUPABASE_KEY`(+필요시 `DATA_BASIC_USER/PASS`) — **vm4 자격증명을 `4k-ml-secrets`(ns ai)에 추가**해야 함.
- Argo `WorkflowTemplate` `generate-vectors` (`Ansible/manifests/4k-ml/`): GPU 불필요, 이미지=4k-ml(numpy/scipy/httpx 포함), secret env 주입.
- 배포 흐름: main push → CI가 4k-ml 이미지 빌드·태그 bump([skip ci]) → ArgoCD가 WT 적용 → Argo UI에서 `generate-vectors` 제출.
- 멱등: `on_conflict=(tmdb_id,vector_version)` upsert라 재실행 안전(전체 재생성). 첫 실행 = roberta 점수 있는 전 영화.

---

## 6. 부수 갱신

- **vm4 `movies.has_vector`**: 대시보드 정렬(`has_vector desc`)이 이걸 씀. 트리거로 자동 set되는지 **구현 때 확인**:
  - 트리거 있음 → 자동.
  - 없음 → G가 처리한 tmdb_id에 대해 `PATCH movies?tmdb_id=in.(...) {has_vector:true}` 배치 업데이트(멱등).
- **vm5 `processing_status.vector_state`**: 처리 완료 영화에 `vector_state='done'` 멱등 갱신(파이프라인 원장 일관).

---

## 7. vm4 RPC 수정 (SQL 마이그레이션 — 사용자가 vm4에서 실행)

후보 검색 RPC 2개가 `movie_vectors`를 버전 필터 없이 조회 → 새 버전 추가 시 여러 버전이 섞여 깨짐. **arousal 버전만 보도록 수정 필요.**

- `find_preferred_movies`, `find_similar_movies` 내부 `movie_vectors` 참조에 `WHERE vector_version = 'roberta-va-v1::arousal'` 추가.
- pgvector 코사인(`<=>`)은 **arousal이 z-score(중심화)** 라 변별 정상.
- RPC 정의는 Supabase(vm4) DB에 있으므로 repo 밖. **수정 SQL을 스펙/플랜에 명시**하고 사용자가 vm4 SQL Editor에서 실행(또는 함수 본문을 받아 정확히 패치). 구현 단계에서 현재 함수 정의를 먼저 덤프해 확인.

---

## 8. FE 최소 변경 (G 범위)

- `app/lib/data.ts` `fetchVector`, `fetchMovieVectors`: 쿼리에 `&vector_version=eq.roberta-va-v1::arousal` 추가 → 앱이 즉시 arousal(z-score) 곡선을 집음.
- `cosineSimilarity`: **변경 불필요**(arousal이 z-score라 현행대로 작동).
- 곡선/지표(`climax.ts`): **변경 불필요**(입력을 내부 재정규화).

**범위 밖(다음 FE sub-project):** valence=색상 이중 인코딩, 유사도 arousal 0.7+valence 0.3 가중결합(valence는 FE에서 평균 중심화 후 기여), 선택적 토글.

---

## 9. 리스크 / 엣지

- **has_vector 갱신 메커니즘 불명** → 구현 때 vm4 트리거 확인, 없으면 명시 업데이트(§6).
- **RPC 정의 repo 밖** → 현재 함수 본문 덤프 후 정확히 버전필터 삽입(§7). 잘못 건드리면 추천 깨짐 → 먼저 read-only로 확인.
- **valence 평탄 영화** → raw라 그대로 저장(스킵 안 함), 색은 중립.
- **두 DB 자격증명 분리** → 읽기 vm5 / 쓰기 vm4, 둘 다 `4k-ml-secrets`에.
- **벡터 스케일 전제(FE)** → arousal z-score 유지로 현 FE(`toDisplayScale`/`climaxMetrics`/cosine) 그대로 호환.

---

## 10. 테스트

- 4K_ML 테스트 러너(pytest) 사용. `process_axis` 순수 함수 단위 테스트:
  - 단일 정점 시계열 → arousal z-score 평균≈0/표준편차≈1, 정점 위치 보존.
  - 평탄 시계열 → arousal None(스킵), valence는 raw 그대로 반환.
  - 고정 [0,1] 그리드 길이 200, 두 축 동일 x.
- 조인 로직 단위 테스트(score→scene→subtitle, 결측 건 제외).
- upsert/HTTP는 모킹. 라이브 검증: 소수 영화 dry-run 후 vm4 행 수·버전·범위(arousal 음수 존재/valence 0~1) 확인.

## 11. 범위 밖

- valence 시각화·가중 유사도(FE sub-project). 재생성 Cron/매니저 트리거(Ops sub-project). 모델 재학습·승격(F의 promote).
