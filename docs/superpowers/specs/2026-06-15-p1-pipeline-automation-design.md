# P1 — 파이프라인 자동화 + 활성버전 포인터 + 스테일 치유 설계

**작성일:** 2026-06-15
**범위:** 결정론적 단계(파싱·스코어·벡터)의 자동화 + 모델 활성버전 포인터 + 스테일 데이터 치유. 학습/승격/예측기 활성로드는 **P2(별도)**.
**관련:** [[project_4k_ml_pipeline]]. 이슈: ①스코어 라벨무관(이미 정상) ②상태원장이 버전무관→재처리불가·스테일 ③ML 단계 자동화 부재.

---

## 1. 목표

1. 모델 **활성버전 단일 포인터** 도입 → 스코어·벡터·FE가 모두 활성버전 기준으로 동작.
2. 파싱·스코어·벡터를 **시간별 CronWorkflow**로 무인화하되, 대상은 **플래그가 아니라 실제 데이터에서 결산**(자가치유).
3. 스테일/고아 데이터 정리 + 상태 재동기화 → 대시보드·FE 정확.

학습/승격은 P1 범위 밖. P1 동안 모델은 기존 `roberta-va-v1` 그대로.

---

## 2. 핵심 결정 (브레인스토밍 확정)

| # | 결정 |
|---|---|
| 1 | 재처리 판단 = **실제 데이터 결산**(현재 활성버전 출력이 빠진 영화를 테이블에서 탐색). 단일 플래그 신뢰 안 함 |
| 2 | 활성버전 = vm5 `model_versions.active` 불리언(단일 진실) + vm4 `app_config` 미러(FE anon 읽기용) |
| 3 | 파싱·스코어·벡터 = Argo **CronWorkflow** 시간별, `concurrencyPolicy: Forbid`, 멱등 |
| 4 | `movies.has_vector` **유지** + 활성버전 벡터 보유 기준으로 재동기화 (대시보드 정렬용 비정규화 플래그) |
| 5 | 학습/승격/예측기 활성로드 = **P2** |

---

## 3. 활성버전 포인터

- **vm5 `model_versions`에 `active boolean default false` 컬럼 추가** (SQL 마이그레이션, 사용자 실행). base 행 `roberta-va-v1`을 `active=true`로. (축 행 `::arousal/::valence`는 그대로, active는 base에만.)
- **vm4 `app_config(key text primary key, value text)` 테이블 생성** + 행 `('active_model_version','roberta-va-v1')`. (SQL, 사용자 실행. anon SELECT 가능해야 — RLS 없거나 read 허용.)
- **BE `/api/active-model`**(GET): vm5 `model_versions?active=eq.true`에서 base 버전 반환 `{ "version": "roberta-va-v1" }`. (운영/디버그용. FE 핫패스는 vm4 미러 사용.)
- 동기화 원칙: vm5 active가 진실. 변경(=P2 승격) 시 vm4 `app_config`도 함께 갱신(write-through). P1에선 둘 다 `roberta-va-v1`로 시드.

---

## 4. ML 잡 — 데이터 결산 타깃

활성 base 버전 `MV`(vm5 `model_versions.active`에서 조회)를 기준으로:

### 4.1 파싱 (`subtitle-parse`, 기존 유지)
- 타깃: `subtitle_state=done & parse_state!=done`. (모델 무관, 현행 그대로.)

### 4.2 스코어 (`serving/db.fetch_score_targets` 수정)
- 기존: `parse_state=done & score_state!=done`.
- 변경: **`parse_state=done` 인 영화 중, 현재 씬에 `{MV}::arousal` 점수가 빠진 영화**.
  - 구현: 활성버전 arousal `scene_scores`(scenes_id) 집합 ∩ 현재 `scenes`(subtitles별) 비교. 한 영화의 현재 씬이 모두 점수 보유면 "scored", 하나라도 없으면 타깃. (고아 scene_scores는 현재 scenes에 없으므로 자동 제외 → 스테일 치유.)
- 처리 후 `score_state=done` 갱신(대시보드용 캐시). 예측기 반환 `model_version`으로 태깅(=MV).

### 4.3 벡터 (`generate_vectors`에 증분 타깃 추가)
- 기존: 활성 점수 있는 전 영화 **전량 재생성**.
- 변경: **`{MV}::arousal` 점수는 있는데 vm4에 `{MV}::arousal` `movie_vectors`가 없는 영화만** 생성(증분). 활성 base는 vm5에서 조회해 버전 문자열 구성.
- 처리 후 vm4 `movies.has_vector=true` + vm5 `vector_state=done`.
- 벡터 버전 문자열은 활성 base 기반(`{MV}::arousal`/`::valence`) — 하드코딩 제거.

---

## 5. CronWorkflow (Argo, ns ai)

`Ansible/manifests/4k-ml/`에 3개 추가(기존 WorkflowTemplate 참조):
- `cronworkflow-parse.yaml` — schedule `5 * * * *`, `workflowTemplateRef: subtitle-parse`
- `cronworkflow-score.yaml` — schedule `20 * * * *`, `workflowTemplateRef: score-scenes`
- `cronworkflow-vector.yaml` — schedule `40 * * * *`, `workflowTemplateRef: generate-vectors`

공통: `concurrencyPolicy: Forbid`, `startingDeadlineSeconds`, `successfulJobsHistoryLimit`/`failedJobsHistoryLimit` 소수. 스코어→벡터 순서가 시간 내 자연 정렬(분 단위 stagger). 멱등이라 겹쳐도 안전.

> CronWorkflow는 Argo `argoproj.io/v1alpha1` kind. argo-workflow ServiceAccount RBAC에 cronworkflows 권한 필요(구현 시 확인, 없으면 Role 추가).

---

## 6. 스테일 정리 / 재동기화

- **고아 scene_scores 삭제(1회 + 옵션 상시)**: `scenes`에 존재하지 않는 `scenes_id`의 scene_scores 제거. vm5 SQL 또는 스코어 잡에 정리 스텝. (재파싱 잔재 청소.)
- **상태 재동기화**: 스코어/벡터 잡이 결산 후 실제 결과로 `score_state`/`vector_state`/`has_vector`를 set → 대시보드가 진실 반영. 활성벡터 없는 영화는 `has_vector=false`로 보정.

---

## 7. FE

- `app/lib/data.ts`: 모듈 로드시(또는 최초 호출 시) vm4 `app_config?key=eq.active_model_version`를 anon으로 읽어 `ACTIVE_VERSION`(예 `roberta-va-v1`) 확보, 못 읽으면 `'roberta-va-v1'` 폴백. `fetchVectorPair`/`fetchMovieVectorPairs`의 `vector_version=in.(${ACTIVE}::arousal,${ACTIVE}::valence)`로 사용. (하드코딩 제거.)
- 대시보드 정렬(`has_vector.desc`)은 그대로(§2 결정4).

---

## 8. 컴포넌트/파일

| 파일 | 변경 |
|---|---|
| vm5 SQL | `model_versions.active` 컬럼 + roberta-va-v1 active (사용자) |
| vm4 SQL | `app_config` 테이블 + active_model_version 행 (사용자) |
| `4K_BE/app/main.py` | `GET /api/active-model` |
| `4K_ML/serving/db.py` | `fetch_score_targets` → 활성버전 결산 + 활성 base 조회 헬퍼 |
| `4K_ML/generate_vectors/db.py`·`generate_vectors.py` | 활성 base 조회 + 증분 타깃(누락 벡터만) + has_vector/vector_state 보정 |
| `4K_ML/db/orphan_cleanup.sql` | 고아 scene_scores 정리(기록·실행) |
| `Ansible/manifests/4k-ml/cronworkflow-{parse,score,vector}.yaml` | 신규 |
| `4K_FE/app/lib/data.ts` | 활성버전 동적 읽기 |

---

## 9. 테스트

- ML: pytest — `fetch_score_targets` 결산 로직(고아/부분점수 제외), 벡터 증분 타깃, 활성 base 조회(모킹). 순수 분리 가능한 부분 단위테스트.
- BE: `/api/active-model` 테스트(모킹).
- FE: `npm run build` + 활성버전 폴백 동작 수동.
- 라이브: 크론 1회 수동 트리거(`argo submit --from cronworkflow/...` 또는 해당 WT) → 스테일 262편이 점수/벡터 채워지는지, has_vector 보정 확인.

---

## 10. 리스크 / 엣지

- **결산 쿼리 비용**: 활성 arousal scene_scores(~57k) + scenes 풀 로드 후 집합 비교. 잡 메모리/시간 OK(현 스코어 잡도 유사 규모). 페이지네이션 필수.
- **CronWorkflow RBAC**: argo-workflow SA에 cronworkflow 권한 없을 수 있음 → Role/RoleBinding 추가.
- **app_config anon 읽기**: vm4 RLS가 막으면 FE가 못 읽음 → 폴백 동작하지만 포인터 무력. 생성 시 anon SELECT 허용 확인.
- **부분 스코어 영화**: 일부 씬만 점수 있는 경우 타깃에 포함해 재스코어(멱등 upsert).
- **has_vector 의미 변경**: 이제 "활성버전 벡터 보유" — 구 rule-v1만 있는 영화는 false로 보정될 수 있음(의도).

## 11. 범위 밖 (P2)

학습 크론(새 라벨 임계), 평가게이트 자동 승격, vm5 active 플래그 이동 + vm4 미러 write-through, 예측기 활성모델 로드(rollout restart), 학습으로 생긴 새 버전의 자동 재채움.
