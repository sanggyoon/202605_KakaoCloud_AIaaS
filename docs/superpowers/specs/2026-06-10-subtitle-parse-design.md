# 자막 파싱 (대사/씬 분리) 설계 (ML 파이프라인 하위 프로젝트 C)

**날짜:** 2026-06-10
**상태:** 승인됨
**상위 맥락:** ML 파이프라인 step 3. vm5 `subtitles.raw_text`(.srt)를 **대사(dialogues)**와 **씬(scenes)**으로 나눠 vm5에 저장한다. 이후 D(LLM 라벨링)가 scenes를 점수화한다. 스키마는 하위 프로젝트 A에서 정의됨(public 스키마).

## 배경 / 문제

자막 원본만으로는 모델이 점수를 매길 단위(씬)가 없다. .srt를 줄 단위 대사로 파싱하고, 규칙(무발화 간격)과 의미(문맥 변화)를 결합해 씬으로 묶어야 D 이후 단계가 가능하다. 씬은 모델이 피크 스코어를 매기는 단위이고, dialogues의 길이·단어수 등은 LLM이 "긴박함"을 판단할 때 참고하는 보조 신호다.

## 목표

- vm5에서 `subtitle_state='done'` & `parse_state!='done'`인 자막을 파싱해 `dialogues`·`scenes`를 채우고 `parse_state='done'`으로 갱신.
- 씬 분할 = **규칙(무발화 gap) + 의미(sentence-transformer 문맥 변화)** 하이브리드.
- 4K_ML의 독립 CLI 배치(이후 Argo로 감싸기 쉽게). ML 의존성(torch/sentence-transformers)은 4K_ML에만.

## 비목표 (YAGNI)

- LLM 점수 라벨링 — 하위 프로젝트 D.
- 매니저 버튼/Argo 래핑 — 추후(파싱은 모델 로딩이 무거워 웹 스트림 부적합).
- 대사/비대사(SDH 묘사) 구분 플래그 — 구분 없이 그대로 저장(아래).
- 다국어 — 영어 단일(all-MiniLM-L6-v2).

## 설계 결정 (확정)

| 항목 | 결정 |
|---|---|
| 실행 | 4K_ML CLI 배치 (`subtitle_parse/`) |
| 대상 | vm5 `subtitle_state='done'` & `parse_state!='done'` |
| 씬 분할 | gap(`>GAP_MS` 기본 3000) **OR** 의미 유사도(`<SIM_THRESHOLD` 기본 0.5) → 경계 |
| 단발 씬 방지 | 현재 씬이 `MIN_LINES`(기본 3)줄 이상일 때만 의미 경계 허용 |
| 세밀도 | 중간(2시간 영화 ≈ 40~70 씬) — RoBERTa 512토큰 적합 + 200포인트 리샘플링 + LLM 비용 균형 |
| 모델 | `sentence-transformers/all-MiniLM-L6-v2` (영어), 배치 인코딩 |
| 의미 비교 | 새 대사 임베딩 vs 현재 씬 평균(centroid) 임베딩 cosine |
| SDH 묘사 | `[explosion]` 등 비대사 cue도 대사와 **구분 없이 그대로** 저장(피처도 그대로) |
| 멱등 | `parse_state='done'`이면 스킵. insert는 on_conflict upsert(failed 재시도 시 충돌 방지) |

## 컴포넌트 / 파일 구조 (`4K_ML/subtitle_parse/`)

- `srt.py` — 순수 .srt 파서
  - `parse_srt(raw_text) -> list[Cue]`: `Cue(index, start_ms, end_ms, text)`. `<i>`/`<...>` 태그 제거, 멀티라인 cue 합치기(개행→공백), 타임코드 파싱(`HH:MM:SS,mmm`), 깨진 블록 스킵.
- `features.py` — 순수 피처
  - `line_features(cues) -> list[dict]`: cue별 `duration_ms`, `char_count`, `word_count`, `gap_before_ms`(직전 cue end와의 간격, 첫 줄 None), `progress_ratio`(=cue 중앙_ms / 마지막 cue end_ms).
- `scenes.py` — 씬 분할(하이브리드)
  - `split_scenes(cues, embeddings, gap_ms, sim_threshold, min_lines) -> list[list[int]]`: cue 인덱스의 씬별 그룹. 경계 규칙은 위 표.
  - `SPLIT_METHOD = "gap3000+sbert-minilm-v1"`(파라미터 반영 문자열).
  - 임베딩은 외부에서 주입(테스트 시 모킹) — 모델 로딩은 배치 메인이 담당.
- `embed.py` — `embed_texts(texts) -> np.ndarray`: all-MiniLM-L6-v2 lazy 로드 + 배치 인코딩.
- `db.py` — vm5 REST 입출력
  - `iter_parsable(client) -> list[dict]`: `subtitles`에서 `subtitle_state='done'`인 행 + 그 tmdb_id의 `parse_state` 조인 판단(또는 processing_status 조회) → 파싱 대상 `{id, tmdb_id, raw_text}`.
  - `save_parse(client, subtitle_id, dialogues, scenes)`: scenes upsert(return id) → dialogues upsert(scenes_id 포함).
  - `set_parse_state(client, tmdb_id, state, error=None)`.
- `parse_subtitles.py` — 배치 메인: 대상 순회 → srt→features→embed→scenes→save → parse_state. 진행 출력(`[12/50] tmdb=... scenes=..`).

## 데이터 흐름 (자막 1편당)

```
subtitles.raw_text
  → parse_srt → cues
  → line_features → 피처
  → embed_texts(cue.text) → 임베딩
  → split_scenes(cues, 임베딩, gap, sim, min_lines) → 씬 그룹
  → scenes upsert (subtitles_id, scene_index, start/end_ms, progress_ratio, text=합본, dialogue_count, split_method)
  → dialogues upsert (각 cue: subtitles_id, scenes_id, line_index, 피처, text)
  → processing_status.parse_state='done'
```
- `scenes.progress_ratio` = 씬 중앙 위치(=(first.start+last.end)/2 / 전체길이).
- `scenes.text` = 씬 내 cue.text를 공백/개행으로 합본(RoBERTa 입력).

## 에러 처리

- 파싱 결과 cue 0개/깨진 srt → `parse_state='failed'` + error, 다음 실행 재시도.
- 임베딩/모델 오류 → `failed`.
- 멱등: done 스킵. failed 재시도는 upsert로 같은 인덱스 덮어쓰기(파싱 결정적이라 인덱스 일치). on_conflict: dialogues=`(subtitles_id,line_index)`, scenes=`(subtitles_id,scene_index)`.
- 극단(씬<5) 케이스도 저장 — 다운스트림 generate_vectors가 MIN_SCENES로 거름.

## 환경변수 / 의존성

- env: `AI_DATABASE_URL`·`AI_DATABASE_KEY`(vm5 REST), 선택 `AI_BASIC_*`. (subdl 불필요.)
- 의존성 추가(4K_ML `requirements.txt`): `sentence-transformers`(+ torch). 모델은 최초 1회 다운로드/캐시. 이미지 크기·콜드스타트 증가 — Argo 워커 노드 고려(추후).

## 테스트 (pytest, 네트워크/모델 없이)

- `srt.parse_srt`: 멀티라인·`<i>`태그·SDH `[..]`·깨진 블록 샘플 → cue 정확.
- `features.line_features`: gap_before_ms(첫 줄 None), word/char_count, progress_ratio 경계.
- `scenes.split_scenes`: ① gap 초과 → 경계 ② 임베딩 유사도 낮음 → 경계(임베딩 직접 주입) ③ min_lines 미만이면 의미 경계 무시 ④ gap·의미 동시.
- `db`/배치: httpx MockTransport로 대상 조회·upsert·상태 전이(done/failed) 모킹.
- `embed.py`: 실제 모델은 테스트에서 제외(통합 시 수동 확인).

## 미해결 / 후속

- 실제 .srt로 gap/sim 기본값 튜닝(첫 실행 후 씬 개수 분포 보고 조정).
- 매니저 진행 표시/Argo 래핑 — 추후 Ops.
- 전체 길이 산정: 마지막 cue end_ms를 영화 길이 proxy로 사용(movies.runtime와 차이 가능, 현재는 cue 기준으로 충분).
