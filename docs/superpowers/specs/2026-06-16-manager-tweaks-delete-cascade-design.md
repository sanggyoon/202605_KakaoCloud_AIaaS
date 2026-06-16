# 매니저 정리 + 삭제 시 처리상태 리셋 설계

**작성일:** 2026-06-16
**범위:** 매니저 페이지 소규모 개선(스코어링 버튼 삭제·활성모델 카드 arousal 강조·외부 링크) + 영화 삭제 시 vm5 processing/vm4 벡터 정리.
**관련:** [[project_4k_ml_pipeline]].

---

## 1. 요구사항 → 결정

| # | 요구 | 결정 |
|---|---|---|
| 1 | "영화 데이터 스코어링 (준비 중)" 버튼 삭제 | FE 매니저에서 제거 |
| 2 | 활성 모델 카드 arousal 강조 | 버전+arousal(Spearman·MAE) 큰 카드, valence는 보조 텍스트 |
| 3 | 외부 링크 버튼 | Grafana/ArgoCD/ArgoWorkflow/SVC DB/AI DB 새 탭 링크 섹션 |
| 4 | DB 삭제 시 처리상태도 리셋 확인 | **현재 안 됨** → DELETE가 vm4 벡터 삭제 + vm5 processing_status pending 리셋 |
| 5 | 수집 수량 배선 확인 | **정상**(버그 아님). backfillN→backfill, collectN→collect 분리. 50개는 중복 제외 후 실제 새 영화 수 → 변경 없음 |
| 6 | 기간 지정 방문자 수 | 시작·종료 날짜 입력 → 그 기간 방문자 수 조회(BE 범위 카운트 + FE 날짜 UI) |
| 7 | '영화 정보 리스트' 버튼 이동 | "기능" 섹션 → "바로가기(링크)" 섹션으로 이동(내부 라우트 유지) |

외부 링크 URL(모두 https): `grafana.peakly.art`, `argocd.peakly.art`, `workflow.peakly.art`, `data.peakly.art`, `ai.peakly.art`.

---

## 2. BE — 삭제 시 정리 (#4)

`delete_movie(tmdb_id)` 확장:
1. (현행) vm4 `movies` 삭제.
2. **vm4 `movie_vectors` 삭제**: `DELETE /rest/v1/movie_vectors?tmdb_id=eq.{id}` (모든 버전 행).
3. **vm5 `processing_status` pending 리셋**: 신규 헬퍼 `_reset_processing(client, tmdb_id)` — `POST processing_status?on_conflict=tmdb_id`로 `{subtitle_state,parse_state,label_state,score_state,vector_state}=pending, retry_count=0, error=null, updated_at=now}` 업서트.
   - vm5 접근은 기존 `active_model`/`_movie_processing` 패턴(AI_DATABASE_URL/KEY + apikey/Bearer).
4. 자막·씬 등 vm5 데이터는 남김(요구는 "pending 리셋"). 재추가 시 크론이 pending을 보고 재처리.
- 부분 실패 허용: vm4 삭제 성공이 우선, vm5/벡터 정리 실패는 로그/무시(삭제 자체는 성공 반환). 단순화를 위해 각 단계 best-effort.

---

## 3. FE — 매니저 페이지 (#1·#2·#3)

### 3.1 스코어링 버튼 삭제 (#1)
- `manager/page.tsx`의 `<button disabled ...>영화 데이터 스코어링 (준비 중)</button>` 블록 제거.

### 3.2 활성 모델 카드 arousal 강조 (#2)
- 기존 4개 동일 StatCard → 재구성:
  - 큰 카드 3개: `버전`(accent) · `Spearman (arousal)`(accent 강조) · `MAE (arousal)`.
  - 그 아래 작은 보조 줄: `valence — Spearman {…} · MAE {…}` (흐린 텍스트, 소수 3자리).
- `fmtMetric` 재사용.

### 3.3 외부 링크 섹션 (#3·#7)
- 새 `<section>` "바로가기": 외부 5개(`<a target="_blank" rel="noopener noreferrer">` 새 탭) + **내부 '영화 정보 리스트'**(버튼 `router.push('/movie_list')`, #7 이동). `cardGrid`/칩 스타일.
- 외부 항목: Grafana, ArgoCD, Argo Workflow, SVC DB(data), AI DB(ai).
- "기능" 섹션에서 '영화 정보 리스트 →' 버튼 제거(#7).

### 3.4 기간 지정 방문자 수 (#6)
- "방문자 통계" 섹션에 날짜 범위 UI: `<input type="date">` 2개(시작/종료) + "조회" 버튼 → `/api/manager/visits/range?start=&end=` 호출 → 결과 수 표시.
- 기본값: 시작=30일 전, 종료=오늘. 잘못된 범위(시작>종료)면 버튼 비활성/메시지.

### 3.5 BE 방문자 범위 엔드포인트 (#6)
- `GET /api/visits/range?start=YYYY-MM-DD&end=YYYY-MM-DD` → `{start, end, count}`.
- `_count(client, "visits", {"and": f"(created_at.gte.{start}T00:00:00,created_at.lt.{end+1d}T00:00:00)"})` (종료일 포함 위해 end+1일 미만). 날짜 파싱 실패 시 400.
- Next 프록시 `app/api/manager/visits/range/route.ts`(GET, querystring 전달).

---

## 4. 테스트

- BE pytest: `delete_movie`가 movies 삭제 + movie_vectors DELETE 호출 + processing_status pending 업서트 호출(모킹으로 각 요청 URL/바디 검증). vm5 env 없으면 movies 삭제만 하고 통과.
- FE: `npm run build` + 수동(버튼 사라짐, arousal 강조 카드, 링크 새 탭).

---

## 5. 리스크 / 엣지

- **삭제 후 자막/씬 잔존**: pending 리셋만이라 재추가 시 재파싱이 옛 씬과 겹칠 수 있음 → P1 결산/고아정리가 흡수. (완전 클린은 범위 밖, 사용자 선택.)
- **vm5 env 미설정**: processing 리셋 스킵(movies 삭제는 성공). best-effort.
- **외부 링크 도메인 미배포**: 링크는 단순 anchor라 안전(클릭 시 해당 서비스 인증은 각자).

## 6. 범위 밖

- 워크플로 수동 트리거 버튼, 실패 항목 뷰, P2(자동 학습·승격), vm5 완전 삭제(클린 슬레이트).
