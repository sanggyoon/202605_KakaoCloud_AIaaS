# 서브프로젝트 D — LLM 라벨링 (Valence + Arousal) 설계

**작성일:** 2026-06-10
**파이프라인 위치:** 7단계 중 4단계 (TMDB → 자막수집 → 파싱 → **LLM 라벨링** → RoBERTa 학습 → KServe 서빙 → 임베딩)

---

## 1. 목표

vm5에 파싱되어 있는 씬(`scenes`)에 대해, LLM(teacher)이 각 씬의 **감정 점수 2축**을 매겨
`scene_scores`에 정답 라벨로 적재한다. 이 라벨은 다음 단계(E)에서 RoBERTa(student) 학습의 ground truth가 된다.

- **Arousal** — 긴장/흥분 강도 (= 기존 "peak/클라이맥스" 축)
- **Valence** — 감정의 긍정/부정

Dominance는 신뢰도·활용도 대비 복잡도가 커서 제외(향후 model_version 행 추가로 무손실 확장 가능).

대상 규모: 영화 ~172편 × 씬 ~60개 ≈ ~10,000 씬.

---

## 2. 핵심 설계 결정 (브레인스토밍 확정 사항)

| 주제 | 결정 | 근거 |
|---|---|---|
| Teacher 모델 | **Claude Sonnet 4.6** (`claude-sonnet-4-6`) | 판단력·비용 균형. 배치 ~$9/회 |
| 호출 방식 | **Batch API** (`/v1/messages/batches`, -50%) | 오프라인 1회성 작업, 비용 절감 |
| 배치 단위 | **영화 1편 = 요청 1개** | 영화 전체(씬 ~60개)를 한 콜에 넣어 영화 내 상대 순서를 정확히 잡음 |
| 점수 축 | **Valence + Arousal** | Arousal=클라이맥스 핵심축, Valence=감정 텍스처. Dominance 제외 |
| 스케일 | **0.0~1.0 절대 앵커** (둘 다) | 영화 간 일관성 → student 라벨 노이즈↓. 서비스의 "영화 내 강조"는 표시단계 정규화로 별도 처리 |
| 출력 형태 | **씬당 `{scene_index, arousal, valence, reason}`** | `reason`으로 사람이 라벨 스팟체크 가능 |
| reason 언어 | **영어** | 자막이 영어, LLM 일관성·토큰 효율 |
| 진행도·발화 피처 | **라벨에 넣지 않음** | student가 추론 시 직접 쓰는 입력. teacher는 순수 서사 긴장도만 판단 |
| 멱등성 | `processing_status.label_state` | 이미 `done`인 영화 스킵 |
| 실행 | Argo WorkflowTemplate (vm5, **GPU 불필요** — API 바운드) | 파싱과 동일 패턴 |

### 라벨 vs 피처 분업 (중요 — E/F/G에 영향)

Student(RoBERTa)는 **하이브리드 구조** = `RoBERTa 텍스트 벡터 ⊕ 숫자 피처(progress_ratio·발화밀도·gap) → MLP 회귀 헤드(2-출력: arousal, valence)`.
진행도·발화 정보는 **student 입력으로 직접 공급**하므로 라벨에 인코딩하지 않는다.
(원칙: student는 추론 시 실제로 받는 입력만 활용 가능.)

### 스케일링은 표시 단계에서

`scene_scores`엔 **절대값** 저장. 서비스 그래프는 영화 단위로 변환:
Min-Max 정규화 + 스무딩(이동평균) + 고정 N포인트 리샘플링. → G/FE에서 구체화(이 스펙 범위 밖).

---

## 3. 데이터 모델

기존 스키마 변경 **없음**. 두 축을 `model_versions` 레지스트리의 별도 행 + `scene_scores`의 별도 행으로 저장.

**`model_versions`에 추가할 행 (라벨링 시작 시 1회 보장):**

```
model_version            kind         description
llm-va-v1::arousal       llm-label    Sonnet 4.6 arousal label, 0-1 absolute anchors
llm-va-v1::valence       llm-label    Sonnet 4.6 valence label, 0-1 absolute anchors
```

**`scene_scores` 적재:** 씬 1개당 2행.

```
scenes_id=123, score=0.82, model_version='llm-va-v1::arousal'
scenes_id=123, score=0.30, model_version='llm-va-v1::valence'
```

`unique(scenes_id, model_version)` 덕분에 on_conflict 업서트로 재실행 안전.

`VERSION_TAG = "llm-va-v1"` 상수 1곳에서 관리, 축 접미사(`::arousal`/`::valence`)를 붙여 사용.

---

## 4. 모듈 구조

`subtitle_parse/`와 분리된 새 패키지 `labeling/` (관심사 독립).

```
4K_ML/labeling/
  __init__.py
  db.py            # vm5 REST: 대상조회, 씬조회, model_versions 보장, scene_scores 업서트, label_state
  prompt.py        # 시스템 루브릭 + 영화별 user 메시지 빌드 + 출력 JSON 스키마
  batch.py         # Anthropic Batch API 래퍼: 요청빌드 / 제출 / 폴링 / 결과수집·파싱
  label_scenes.py  # 오케스트레이션 run()
4K_ML/tests/
  test_label_prompt.py
  test_label_batch.py
  test_label_db.py
  test_label_main.py
```

`anthropic` SDK를 `requirements.txt`에 추가.

### 4.1 `labeling/db.py`

`subtitle_parse/db.py`의 인증 헬퍼(`_ai`/`_auth`/`_headers`)와 동일 패턴(패키지 독립 위해 자체 보유). 함수:

- `fetch_label_targets(client) -> list[int]`
  `processing_status`에서 `parse_state=='done' and label_state!='done'`인 `tmdb_id`.
- `fetch_scenes(client, tmdb_id) -> list[dict]`
  해당 영화의 씬을 `scene_index` 순으로: `subtitles`에서 `id`(subtitles_id) 조회 → `scenes`에서 `select=scene_index,text&subtitles_id=eq.{id}&order=scene_index`. 반환 행: `{scenes_id, scene_index, text}` (scenes.id 포함 — 점수 적재용).
- `ensure_model_versions(client) -> None`
  두 축 행을 `model_versions`에 on_conflict 업서트(있으면 무시).
- `upsert_scene_scores(client, rows) -> None`
  `scene_scores`에 on_conflict=`scenes_id,model_version` 업서트.
- `set_label_state(client, tmdb_id, state, error=None) -> None`
  `processing_status`의 `label_state`만 갱신(파싱의 `set_parse_state`와 동일 구조, 컬럼만 다름).

### 4.2 `labeling/prompt.py`

- `RUBRIC` (시스템 프롬프트 문자열) — 두 축의 0~1 절대 앵커:

  ```
  Arousal (intensity/excitement/tension):
    0.0 static/calm (background, mundane dialogue, transitions)
    0.3 mild stirring (seeds of conflict)
    0.6 elevated (confrontation, danger, chase)
    0.9-1.0 peak (climax, maximum action/clash)
  Valence (emotional positivity/negativity):
    0.0 very negative (fear, tragedy, despair, death)
    0.5 neutral (factual, ordinary conversation)
    1.0 very positive (joy, triumph, love, reconciliation)
  ```
  + 지시: 영화 전체를 보고 절대 앵커로 채점, 각 씬에 두 축 점수와 한 줄 영어 reason 반환.

- `build_user_message(scenes: list[dict]) -> str`
  씬을 `[scene_index] text...` 형식으로 인덱스와 함께 직렬화.
- `OUTPUT_SCHEMA` (structured outputs용 JSON 스키마):

  ```json
  {"type":"object","additionalProperties":false,
   "required":["scenes"],
   "properties":{"scenes":{"type":"array","items":{
     "type":"object","additionalProperties":false,
     "required":["scene_index","arousal","valence","reason"],
     "properties":{
       "scene_index":{"type":"integer"},
       "arousal":{"type":"number"},
       "valence":{"type":"number"},
       "reason":{"type":"string"}}}}}}
  ```
  (JSON 스키마는 min/max 수치 제약 미지원 → 0~1 범위는 클라이언트에서 clamp 검증.)

### 4.3 `labeling/batch.py`

Anthropic 공식 SDK 사용(`from anthropic import Anthropic`, `messages.batches`).

- `build_requests(movies) -> list[Request]`
  영화별 `Request(custom_id=str(tmdb_id), params=MessageCreateParamsNonStreaming(...))`.
  params: `model="claude-sonnet-4-6"`, `max_tokens=8000`, `thinking={"type":"disabled"}`(비용 예측성 — 점수는 structured 추출, reason이 근거 제공), `system=RUBRIC`(+cache_control ephemeral), `output_config={"format":{"type":"json_schema","schema":OUTPUT_SCHEMA}}`, `messages=[{"role":"user","content":build_user_message(scenes)}]`.
- `submit(client, requests) -> str` → batch.id (눈에 띄게 print, 선택 resume용)
- `poll(client, batch_id, interval=60) -> None` → `processing_status=='ended'`까지 대기
- `collect(client, batch_id) -> Iterator[(tmdb_id, parsed|None, error|None)]`
  결과 스트림에서 succeeded → 첫 text 블록 JSON 파싱, errored/expired → error.

### 4.4 `labeling/label_scenes.py` — `run()`

1. env 확인(`AI_DATABASE_URL`, `ANTHROPIC_API_KEY`). 없으면 SystemExit.
2. `db.ensure_model_versions(client)`.
3. `targets = db.fetch_label_targets(client)`. 비면 종료.
4. 각 target의 `scenes = db.fetch_scenes(...)`; 씬 없으면 스킵.
   `LABEL_BATCH_ID` env가 있으면 제출 생략하고 그 배치 resume(크래시 복구용).
5. `batch.submit` → `batch.poll` → `batch.collect`.
6. 결과별:
   - succeeded: 각 씬을 0~1 clamp 후 arousal/valence 2행으로 `scene_scores` 업서트 →
     `set_label_state(tmdb_id, "done")`.
   - errored/파싱실패: `set_label_state(tmdb_id, "failed", err[:500])`.
7. `print({"done":..,"failed":..})`.

씬↔결과 매핑: `scene_index`로 `fetch_scenes`의 `scenes_id`에 연결.

---

## 5. 비용 (확정)

- 입력 ~2.1M tok × $3/M = ~$6.3
- 출력 ~0.5M tok × $15/M = ~$7.5 — 출력은 씬당 `reason` 텍스트가 지배. 2축이라도 숫자 하나만 더 붙어 증가 미미.
- 표준 ~$14 → **Batch -50% → ~$7 / 1회** (대사량 많은 영화 섞이면 상한 ~$9).
- 파이프라인 전체에서 토큰 비용이 드는 유일한 단계(E/F/G는 self-host).

---

## 6. 배포·실행

- `4K_ML/Dockerfile` 재사용(현 sentence-transformers 베이스). `anthropic` 추가.
- 새 WorkflowTemplate `Ansible/manifests/4k-ml/workflowtemplate-llm-labeling.yaml`:
  command `python -m labeling.label_scenes`, **GPU 리소스 없음**(runtimeClassName/nodeSelector/nvidia.com/gpu 제거), envFrom `4k-ml-secrets`.
- `ANTHROPIC_API_KEY`를 `4k-ml-secrets`에 추가(사용자가 kubectl로 수동 주입).
- CI(`deploy-4k-ml.yml`)가 이미지 태그 자동 bump(파싱 템플릿과 동일 sed 패턴 1줄 추가).
- 실행: 파싱처럼 UI 또는 `kubectl create -f` 1회 트리거(테스트용 Workflow yaml 추가).

---

## 7. 테스트 (TDD)

- `test_label_prompt.py` — `build_user_message`가 scene_index 포함 직렬화; `OUTPUT_SCHEMA` 형태.
- `test_label_batch.py` — `build_requests`가 영화당 1요청, custom_id=tmdb_id, 모델/스키마 세팅; `collect`가 succeeded JSON 파싱·errored 처리(SDK 모킹).
- `test_label_db.py` — `fetch_label_targets` 필터(parse done & label!=done), `upsert_scene_scores` on_conflict 파라미터, `ensure_model_versions` payload (httpx 모킹).
- `test_label_main.py` — `run()`이 모킹된 batch/db로 씬당 2행(arousal/valence) 적재 + clamp + label_state 전이(파싱 `test_parse_main` 패턴).

---

## 8. 범위 밖 (다음 서브프로젝트)

- E: 하이브리드 RoBERTa 2-출력 회귀 학습(Argo).
- F: KServe 서빙.
- G: 표시단계 정규화/리샘플링 + 서비스 DB 적재.
- Ops: CronWorkflow 스케줄링, 매니저 트리거, 워크플로 아카이브.
```