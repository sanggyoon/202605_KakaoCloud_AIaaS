# 매니저 모달 처리정보·단건 재처리 + 활성모델 지표 카드 설계

**작성일:** 2026-06-15
**범위:** 매니저 `MovieDetailModal` 개선(처리정보·단건 재처리·벡터섹션 삭제) + 매니저 페이지 활성모델 지표 카드. BE 엔드포인트 추가.
**관련:** [[project_4k_ml_pipeline]]. 선행: P1(활성버전 포인터·결산 크론), GPU 배치.

---

## 1. 목표

1. 매니저 영화 모달에서 **그 영화의 처리 현황**(상태 5개 + 개수)을 본다.
2. 모달에서 **단건 자막 강제 재수집 + 다운스트림 재처리**("이 영화 다시 처리") 버튼.
3. 모달의 **클라이맥스 벡터 섹션 삭제**(표시·textarea·저장).
4. 매니저 페이지에 **활성 모델 + 지표 카드**(읽기 전용).

---

## 2. 핵심 결정 (브레인스토밍 확정)

| # | 결정 |
|---|---|
| 1 | 처리정보 = processing_status 5개 상태(+retry) + 개수(scenes·dialogues·활성버전 score 수·has_vector) |
| 2 | 자막 버튼 = **강제 재수집 + parse/score/vector_state=pending 리셋**(label 제외) → 크론/GPU 자동 재처리 |
| 3 | 모달 클라이맥스 벡터 섹션·저장 페이로드의 vector **삭제** |
| 4 | 활성모델 지표 카드 = `/api/active-model`에 metrics 포함 → 매니저 페이지 읽기전용 카드 |

범위 밖(별도): 워크플로 수동 트리거 버튼, per-movie 부분 재처리, 실패항목 뷰.

---

## 3. BE 변경

### 3.1 `/api/movies/{tmdb_id}/detail` — processing 추가
- 기존 `{movie, vector}` 응답에 **`processing`** 키 추가(vm5 조회). `vector`는 응답에 남겨도 FE가 안 쓰면 무방하나, 깔끔히 유지(FE가 무시).
- `processing` = `{ states: {subtitle_state,parse_state,label_state,score_state,vector_state, retry_count}, counts: {scenes, dialogues, scores_active, has_vector} }`.
- 신규 헬퍼 `_movie_processing(tmdb_id)`(vm5 REST, AI 자격): processing_status 1행 → subtitles id → scenes count·dialogues count·scene_scores(활성 `{mv}::arousal`) count(Range `count=exact`). 활성 base는 vm5 `model_versions.active`(없으면 roberta-va-v1). has_vector는 movie 행에서.

### 3.2 `POST /api/movies/{tmdb_id}/reprocess` — 단건 재처리
- `subtitle_collect.collect_one(client, tmdb_id)` 신규: 기존 `search/choose/download_and_extract/save_subtitle/set_status` 재사용, **상태 게이트 무시(강제)**. 결과 상태 `done|skipped|failed` 반환.
- 성공/완료 후 **다운스트림 리셋**: vm5 processing_status PATCH `parse_state=pending, score_state=pending, vector_state=pending`(label_state 유지).
- 응답 `{subtitle: "done"|"skipped"|"failed", message}`.
- 단건이라 동기 처리(스트리밍 불필요). subdl rate limit/없음은 메시지로.

### 3.3 `/api/active-model` — metrics 포함
- 기존 `{version}` → `{version, metrics}`. vm5 `model_versions?active=eq.true&select=model_version,metrics`에서 base 행의 metrics jsonb 반환. 폴백 `{version:"roberta-va-v1", metrics:{}}`.

---

## 4. FE 변경

### 4.1 `MovieDetailModal.tsx`
- **벡터 섹션 삭제**: "클라이맥스 벡터" Section·textarea(`vectorText`)·관련 state·`vecPreview` 제거. 저장 payload에서 `vector` 제거(메타만 PATCH). 벡터 배지/버전/정규화/스무딩 KV도 처리현황 카운트로 대체(또는 제거).
- **처리 현황 섹션 추가**: detail의 `processing` 렌더 — 상태 5개 색칩(완료/대기/실패/스킵, 기존 STATE 색 재사용 가능) + 개수(씬/대사/점수/벡터유무).
- **"이 영화 다시 처리 (자막 재수집)" 버튼**: `POST /api/manager/movies/{tmdb_id}/reprocess` → 로딩 → 결과 토스트/메시지 → detail 재조회(처리현황 갱신). 버튼은 파괴적이므로 confirm 1회.

### 4.2 Next 프록시 라우트
- `app/api/manager/movies/[tmdb_id]/reprocess/route.ts` (POST → BE `/api/movies/{tmdb_id}/reprocess`).
- `app/api/manager/active-model/route.ts` (GET → BE `/api/active-model`).

### 4.3 매니저 페이지 활성모델 카드
- `manager/page.tsx`: 마운트 시 `/api/manager/active-model` fetch → 카드 "활성 모델: {version}" + 지표(spearman_movie_arousal, mae_arousal, spearman_movie_valence 등 있는 것만, 소수 3자리). "방문자 통계" 위나 "처리 현황" 옆 적절히 배치.

---

## 5. 컴포넌트/파일

| 파일 | 변경 |
|---|---|
| `4K_BE/app/main.py` | detail에 processing / `POST .../reprocess` / active-model metrics |
| `4K_BE/app/subtitle_collect.py` | `collect_one(client, tmdb_id)` 강제 단건 + 다운스트림 리셋 헬퍼 |
| `4K_FE/app/components/MovieDetailModal.tsx` | 벡터 섹션 삭제, 처리현황 + 재처리 버튼 |
| `4K_FE/app/api/manager/movies/[tmdb_id]/reprocess/route.ts` | 신규 프록시 |
| `4K_FE/app/api/manager/active-model/route.ts` | 신규 프록시 |
| `4K_FE/app/manager/page.tsx` | 활성모델 지표 카드 |

---

## 6. 테스트

- BE pytest: `collect_one` 흐름(모킹: search→choose→save→set_status, 강제), reprocess가 다운스트림 pending 리셋 호출, detail processing 카운트 집계(모킹), active-model metrics 포함/폴백.
- FE: `npm run build`(타입체크) + 수동(모달 처리현황·재처리 버튼·벡터섹션 사라짐·활성모델 카드).

---

## 7. 리스크 / 엣지

- **재수집 후 고아 데이터**: 재파싱 시 씬 id 바뀌어 옛 scene_scores 고아 → P1 결산/고아정리가 처리. label은 유지(학습용).
- **subdl rate limit/없음**: collect_one이 skipped/failed 반환 → 메시지로 표시(에러 아님).
- **per-movie count 쿼리 비용**: 단건이라 수 회 REST 호출 — 무방.
- **detail 응답 호환**: `vector` 키 남겨도 FE 미사용이라 안전. processing 추가는 비파괴적.
- **활성모델 metrics 없음**: 폴백 빈 객체 → 카드는 버전만 표시.

## 8. 범위 밖

- 워크플로 수동 트리거(별도 Ops sub-project), per-movie 부분 재처리, 실패항목 뷰, 라이브 모니터링.
