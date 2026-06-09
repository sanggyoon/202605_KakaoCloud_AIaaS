# vm5 AI DB 스키마 설계 (ML 파이프라인 하위 프로젝트 A)

**날짜:** 2026-06-09
**상태:** 승인됨
**상위 맥락:** 4K Cinema 피크-스코어 ML 파이프라인 7단계 중 하위 프로젝트 A (데이터 토대).
이후 B(자막 수집)·C(파싱)·D(LLM 라벨링)·E(RoBERTa 학습)·F(KServe 서빙)·G(임베딩)·H(평가·모니터링)가 이 스키마 위에 올라간다.

## 배경 / 문제

ML 파이프라인을 vm5 AI DB(Supabase/Postgres)에 처음부터 구축한다. 현재 vm5는 인프라만 떠 있고 스키마·데이터 모두 비어 있다. 연결된 외부(EXT) Supabase는 프로토타입 더미 데이터로, `training` 스키마(`subtitles`/`scenes`/`scene_scores`)의 형태만 참고용이다.

이 spec은 파이프라인 전 단계가 공유할 **데이터 계약(스키마)**을 정의한다. 자막 수집·파싱·라벨링·학습·서빙 코드는 이후 별도 하위 프로젝트에서 작성한다.

## 목표

- vm5 Supabase에 `training` 스키마와 6개 테이블을 생성하는 멱등 DDL(`CREATE ... IF NOT EXISTS`) 작성.
- 파이프라인 단계 간 관계(자막 → 대사 → 씬 → 점수)와 영화별 진행 상태를 표현.
- LLM 라벨과 RoBERTa 예측이 한 테이블에서 `model_version`으로 공존(이후 평가 비교의 토대).
- vm5 70GB 스토리지 제약 안에서 자막 원본 텍스트까지 보관.

## 비목표 (YAGNI)

- 자막 수집·파싱·라벨링·학습·서빙 **코드** — 각 하위 프로젝트(B~H)에서.
- pgvector / `movie_vectors` — 서비스 DB(vm4)에 그대로 둔다. vm5는 학습 데이터 전용.
- 다국어 — 영어 단일. (`language` 컬럼은 두되 'en' 고정.)
- 영화 메타(title/genre 등) 사본 — vm5엔 두지 않고 `tmdb_id`로만 참조(크로스 DB FK 없음).
- RLS/권한 정책 — service_role 키로 서버 측에서만 접근하므로 이번 범위 밖.

## 설계 결정 (확정)

| 항목 | 결정 | 근거 |
|---|---|---|
| 스키마 네이밍 | `training` | 기존 `generate_vectors.py`의 `Accept-Profile: training`과 일관 |
| 언어 | 영어 단일 | 다운스트림 모델(roberta-base, all-MiniLM류 sbert) 선택지 넓음 |
| 점수 척도 | 연속값 0.0~1.0 (회귀) | 그래프 매끄러움 + z-score 정규화와 호환, LLM이 미세차 표현 가능 |
| 자막 보관 | DB `raw_text`, 영화당 1개 | 재파싱·재현 용이, .srt 수백KB라 70GB 내 충분 |
| 씬 정의 | 규칙(무발화 gap) + 의미(sentence-transformer 맥락 변화) | step 3에서 결정, 스키마는 결과를 `scenes`/`split_method`로 보존 |
| 진행 추적 | 전용 `processing_status` 테이블 | 단계별 실패·재시도·재개 명확 |
| FK 네이밍 | 참조 테이블명 + `_id` (예: `subtitles_id`, `scenes_id`) | 기존 EXT 스키마/`generate_vectors.py` 관례와 일치 |

## 스키마 (DDL)

```sql
create schema if not exists training;

-- 1. 자막 원본 (영화당 1개)
create table if not exists training.subtitles (
  id               bigint generated always as identity primary key,
  tmdb_id          bigint not null unique,
  language         text   not null default 'en',
  provider         text,                       -- 'subdl'
  provider_file_id text,                       -- subdl 파일/릴리스 id
  release_name     text,                       -- subdl 릴리스명 (우선순위 근거 보존)
  raw_text         text   not null,            -- .srt 원본
  created_at       timestamptz not null default now()
);

-- 3. 씬 (모델 점수 대상) — dialogues가 참조하므로 먼저 생성
create table if not exists training.scenes (
  id             bigint generated always as identity primary key,
  subtitles_id   bigint not null references training.subtitles(id) on delete cascade,
  scene_index    int    not null,              -- 영화 내 씬 순서
  start_ms       int    not null,
  end_ms         int    not null,
  progress_ratio double precision not null,    -- 씬 중앙 위치 0~1 (그래프 x축)
  text           text   not null,              -- 씬 내 대사 합본 (RoBERTa 입력)
  dialogue_count int    not null default 0,
  split_method   text,                         -- 예: 'gap+sbert-v1' (재현용)
  created_at     timestamptz not null default now(),
  unique (subtitles_id, scene_index)
);
create index if not exists scenes_subtitles_id_idx on training.scenes (subtitles_id);

-- 2. 대사 (자막 한 줄 = 1행, LLM 보조 피처 포함)
create table if not exists training.dialogues (
  id             bigint generated always as identity primary key,
  subtitles_id   bigint not null references training.subtitles(id) on delete cascade,
  scenes_id      bigint references training.scenes(id) on delete set null,  -- step 3에서 배정
  line_index     int    not null,              -- 자막 내 순서
  start_ms       int    not null,
  end_ms         int    not null,
  duration_ms    int    not null,              -- 피처: 발화 길이
  text           text   not null,
  char_count     int    not null,             -- 피처
  word_count     int    not null,             -- 피처
  gap_before_ms  int,                          -- 피처: 직전 발화와의 무발화 간격(첫 줄은 null)
  progress_ratio double precision not null,    -- 영화 내 위치 0~1
  unique (subtitles_id, line_index)
);
create index if not exists dialogues_subtitles_id_idx on training.dialogues (subtitles_id);
create index if not exists dialogues_scenes_id_idx on training.dialogues (scenes_id);

-- 6. 모델 버전 레지스트리 (scene_scores가 참조하므로 먼저 생성)
create table if not exists training.model_versions (
  model_version text primary key,              -- 'rule-v1', 'llm-label-v1', 'roberta-v1'
  kind          text not null,                 -- 'rule' | 'llm' | 'roberta'
  description   text,
  metrics       jsonb,                         -- 평가 지표(H 단계에서 채움)
  created_at    timestamptz not null default now()
);

-- 4. 씬 점수 (씬당·버전당 1개; LLM 라벨과 모델 예측 공존)
create table if not exists training.scene_scores (
  id            bigint generated always as identity primary key,
  scenes_id     bigint not null references training.scenes(id) on delete cascade,
  score         double precision not null,     -- 0~1
  model_version text not null references training.model_versions(model_version),
  created_at    timestamptz not null default now(),
  unique (scenes_id, model_version)
);
create index if not exists scene_scores_model_version_idx on training.scene_scores (model_version);

-- 5. 영화별 파이프라인 진행 상태
create table if not exists training.processing_status (
  tmdb_id        bigint primary key,
  subtitle_state text not null default 'pending',  -- pending|done|failed|skipped
  parse_state    text not null default 'pending',
  label_state    text not null default 'pending',  -- LLM 라벨링
  score_state    text not null default 'pending',  -- 모델 추론
  vector_state   text not null default 'pending',  -- 임베딩 → 서비스 DB
  error          text,
  retry_count    int  not null default 0,
  updated_at     timestamptz not null default now()
);
```

생성 순서 주의: `scenes` → `dialogues`(scenes 참조) → `model_versions` → `scene_scores`(model_versions 참조). DDL은 이 순서로 작성.

## 엔티티 관계

```
movies(vm4, tmdb_id)  ◀┄┄(논리 참조, FK 아님)
        │
   training.subtitles (1:1 영화)
        │ 1:N
   training.dialogues ──N:1──▶ training.scenes (씬 배정)
        ▲                          │ 1:N
        └──────(같은 subtitle)─────┘
                                   │
                          training.scene_scores ──N:1──▶ training.model_versions

training.processing_status : tmdb_id 단위 단계 상태 (독립)
```

## 데이터 흐름 (이 스키마를 채우는 이후 단계)

1. **B 자막 수집:** subdl에서 자막 1개 선택 → `subtitles` insert, `processing_status.subtitle_state='done'`.
2. **C 파싱:** `subtitles.raw_text` 파싱 → `dialogues`(피처 포함) insert → 규칙+sbert로 씬 그룹핑 → `scenes` insert + `dialogues.scenes_id` 갱신. `parse_state='done'`.
3. **D LLM 라벨링:** `scenes`(+ 소속 `dialogues` 피처) → LLM 점수 → `scene_scores`(model_version='llm-label-vN') insert. `label_state='done'`.
4. **E/F 학습·추론:** 라벨로 RoBERTa 학습(E) → 모델이 씬 점수 추론 → `scene_scores`(model_version='roberta-vN'). `score_state='done'`.
5. **G 임베딩:** `scene_scores`(원하는 model_version) + `scenes.progress_ratio` → 200차원 벡터 → vm4 `movie_vectors`. `vector_state='done'`.

## 에러 처리 / 운영

- 멱등 DDL(`if not exists`) — 재실행 안전.
- 단계 실패 시 해당 `*_state='failed'` + `error` 기록, `retry_count` 증가 → 재시도/재개 기준.
- `subtitles`/`scenes` 삭제 시 하위 행 cascade. `dialogues.scenes_id`는 씬 재계산을 위해 `set null`(대사 자체는 보존).
- `model_versions` 행이 먼저 있어야 `scene_scores` insert 가능(FK) — 각 단계가 자기 model_version을 upsert 후 점수 insert.

## 테스트 / 검증

- DDL을 로컬 Postgres(또는 vm5 스테이징)에서 실행 → 6개 테이블·인덱스·FK 생성 확인.
- 멱등성: DDL 2회 연속 실행 시 에러 없음 확인.
- 스모크: 더미 1행씩(subtitle→scene→dialogue→model_version→scene_score→status) insert가 FK/unique 제약을 통과하는지, 잘못된 FK insert가 거부되는지 확인.

## 미해결 / 후속

- 인덱스 추가 튜닝(예: `scenes(progress_ratio)`, 부분 인덱스)은 데이터·쿼리 패턴이 보이면 G·H에서.
- `model_versions.metrics` 스키마(어떤 지표를 담을지)는 H(평가·모니터링)에서 확정.
- DDL을 어디서 관리/적용할지(예: `4K_ML/db/schema.sql` + 수동 적용 vs 마이그레이션 도구)는 구현 계획에서 결정.
