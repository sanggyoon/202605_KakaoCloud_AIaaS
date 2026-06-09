# 자막 수집 설계 (ML 파이프라인 하위 프로젝트 B)

**날짜:** 2026-06-09
**상태:** 승인됨
**상위 맥락:** 4K Cinema 피크-스코어 ML 파이프라인 step 2. 하위 프로젝트 A(vm5 `training` 스키마)를 토대로, subdl에서 영화 자막을 수집해 vm5 `training.subtitles`에 적재한다. 이후 C(파싱)가 이 데이터를 소비한다.

## 배경 / 문제

vm5 AI DB에 영화별 영어 자막 원본을 채워야 C(대사/씬 분리)·D(LLM 라벨링)가 가능하다. subdl은 영화 하나에 여러 자막 후보를 주지만 평점·다운로드 수 같은 품질 지표를 응답에 포함하지 않으므로, 사용 가능한 필드(`language`/`format`/`hi`/`release_name`)와 반환 순서로 하나를 규칙 선택해야 한다.

## 목표

- subdl에서 영화별 영어 자막 1개를 규칙 선택·다운로드해 `training.subtitles`에 적재.
- vm4 `movies`를 대상으로 순회하며 vm5 `processing_status.subtitle_state`를 멱등 원장으로 사용(재실행 시 `done` 스킵, `pending`/`failed`만 처리).
- 무료 키(2,000 요청/일) 한도 안에서 페이싱·1회 상한·우아한 중단으로 안전하게 동작.
- 수동 실행 가능한 깨끗한 CLI 배치로 작성(이후 Argo로 감싸기 쉽게).

## 비목표 (YAGNI)

- **제어 계층** — 매니저 페이지 진행률 UI·트리거 버튼, Argo Workflow/CronWorkflow 래핑은 별도 "Ops/제어 콘솔" 하위 프로젝트. (실행/제어 분리 원칙: 무거운 배치는 Argo가 실행, 매니저 페이지는 status를 읽어 보여주고 트리거만.)
- 다국어 — 영어 단일.
- 자막 후보 여러 개 보관 — 영화당 1개만.
- 파싱(대사/씬 분리) — 하위 프로젝트 C.

## 설계 결정 (확정)

| 항목 | 결정 |
|---|---|
| 소스 | subdl API (`api.subdl.com/api/v1/subtitles`), 무료 키 2,000 요청/일 |
| 언어 | 영어 단일 (`languages=EN`, `type=movie`) |
| 선택 규칙 | ① EN·`format=srt`·단편(full_season 아님) 필터 → ② SDH(`hi=1`) 우선 → ③ subdl 반환순 1등 |
| 폴백 | SDH srt 없으면 비SDH srt, 그것도 없으면 `skipped` |
| zip 내 srt 다수 | 가장 큰 .srt 선택(가장 완전) |
| 저장 | `raw_text`에 .srt 텍스트, 영화당 1개(upsert on tmdb_id) |
| 대상·멱등 | vm4 `movies` 순회, vm5 `processing_status.subtitle_state` 원장(done 스킵) |
| 상태 의미 | 없음=`skipped`(재시도 안 함), 오류=`failed`(다음 실행 재시도), ratelimit=실행 중단(pending 유지) |
| SDH 기록 | `subtitles.is_sdh boolean` 컬럼 추가 |

## subdl API 계약 (구현 시 실제 응답으로 필드명 확정)

**검색:** `GET https://api.subdl.com/api/v1/subtitles`
파라미터: `api_key`, `tmdb_id`, `type=movie`, `languages=EN`, `subs_per_page=30`, 플래그 `hi=1`·`releases=1`.
응답: `{ status, results, subtitles: [ { release_name, name, language, hi, url, full_season, format? }, ... ] }`.
- `url`은 경로(예: `/subtitle/123-456.zip`) → 다운로드는 `https://dl.subdl.com` + `url`.
- `format`이 응답에 없을 수 있음 → `name`이 `.srt`로 끝나면 srt로 간주.
- 일일 한도 초과/429 → rate-limit으로 처리.

**다운로드:** zip(공개, 키 불필요) → 압축 해제 → .srt 텍스트(utf-8, 실패 시 latin-1 폴백 디코딩).

> 주의: subdl 응답의 정확한 필드명(`language` vs `lang`, `hi` 타입 등)은 구현 첫 단계에서 실제 호출로 확인하고 파서를 맞춘다.

## 컴포넌트 / 파일 구조 (`4K_ML/subtitle_fetch/`)

- `subdl_client.py` — subdl 호출 전담
  - `search(tmdb_id) -> list[dict]`: 검색 결과의 subtitles 배열 반환
  - `download_and_extract(download_url) -> str`: zip 받아 가장 큰 .srt 텍스트 반환
  - `SubdlRateLimit(Exception)`: 429/일일한도 감지 시 raise
- `select.py` — 순수 선택 로직(네트워크 없음)
  - `choose(candidates: list[dict]) -> dict | None`: 필터·SDH우선·반환순 규칙
  - `is_srt(c) -> bool`, `is_sdh(c) -> bool` 등 보조 순수 함수
- `db.py` — DB 입출력
  - `iter_movies() -> Iterable[int]`: vm4 `movies`에서 tmdb_id 페이지네이션(REST, `DATA_SUPABASE_*`)
  - `get_state(conn, tmdb_id) -> str | None`: vm5 `processing_status.subtitle_state`
  - `save_subtitle(conn, tmdb_id, chosen, raw_text)`: `subtitles` upsert(on conflict tmdb_id)
  - `set_status(conn, tmdb_id, state, error=None)`: `processing_status` upsert + `updated_at`/`retry_count`
- `fetch_subtitles.py` — 배치 메인(아래 흐름), env 검증·페이싱·상한·우아한 중단

## 데이터 흐름 (영화 1편당)

```
vm4 movies ─tmdb_id▶ ① vm5 status 확인 (subtitle_state=='done' → 스킵, subdl 호출 안 함)
                     ② subdl.search(tmdb_id) → choose(candidates)
                        └ None → set_status('skipped')
                     ③ download_and_extract(url) → raw_text
                     ④ save_subtitle(tmdb_id, chosen, raw_text)   (is_sdh 포함)
                     ⑤ set_status('done')
   오류 → set_status('failed', error), retry_count++
   SubdlRateLimit → 실행 중단(현재 영화 pending 유지)
```

## 스키마 변경

`db/schema.sql`의 `subtitles`에 컬럼 추가 + vm5 적용:

```sql
alter table training.subtitles add column if not exists is_sdh boolean;
```

`schema.sql`에도 `is_sdh boolean` 줄을 반영(멱등 유지). vm5 적용은 `apply_schema` 재실행 또는 SQL Editor.

## 에러 처리 / 한도

- 페이싱: 요청 간 `REQUEST_DELAY`(기본 0.5s).
- 1회 상한: `MAX_REQUESTS_PER_RUN`(기본 1800) 도달 시 정상 종료(나머지 다음 실행).
- `SubdlRateLimit` 발생 시 즉시 정상 종료, 처리 중이던 영화는 pending.
- 멱등: subtitles upsert, status done 스킵 → 중복 다운로드·중복 행 없음.
- 디코딩 실패·빈 srt·zip에 srt 없음 → `failed`(원인 기록).

## 환경변수

`SUBDL_API_KEY`(신규), `AI_DATABASE_URL`(vm5 psycopg, A에서), `DATA_SUPABASE_URL`·`DATA_SUPABASE_KEY`(vm4 movies 읽기, 기존). 로컬은 `4K_ML/.env`.

## 테스트 (간단)

- `select.choose()`: SDH 우선, srt 필터, 폴백(비SDH), 후보 없음→None — 순수 유닛(픽스처 dict).
- srt 추출: 메모리 zip(여러 .srt) → 가장 큰 것 선택 검증.
- `subdl_client.search()`: httpx MockTransport로 응답 파싱·rate-limit 예외.
- 배치 status 전이: db·subdl 모킹으로 done/skipped/failed 경로 각 1개.

## 미해결 / 후속

- subdl 응답 필드명 실측 확정(구현 1단계).
- 제어 콘솔(매니저 페이지 진행률 + Argo 트리거)·CronWorkflow 래핑 — 별도 하위 프로젝트.
- vm4 movies가 많아지면 `MAX_REQUESTS_PER_RUN`·`REQUEST_DELAY` 튜닝, 유료 키 전환 검토.
