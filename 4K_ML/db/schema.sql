create schema if not exists training;

-- 1. 자막 원본 (영화당 1개)
create table if not exists training.subtitles (
  id               bigint generated always as identity primary key,
  tmdb_id          bigint not null unique,
  language         text   not null default 'en',
  provider         text,
  provider_file_id text,
  release_name     text,
  raw_text         text   not null,
  is_sdh           boolean,
  created_at       timestamptz not null default now()
);

-- 3. 씬 (dialogues가 참조하므로 먼저 생성)
create table if not exists training.scenes (
  id             bigint generated always as identity primary key,
  subtitles_id   bigint not null references training.subtitles(id) on delete cascade,
  scene_index    int    not null,
  start_ms       int    not null,
  end_ms         int    not null,
  progress_ratio double precision not null,
  text           text   not null,
  dialogue_count int    not null default 0,
  split_method   text,
  created_at     timestamptz not null default now(),
  unique (subtitles_id, scene_index)
);
create index if not exists scenes_subtitles_id_idx on training.scenes (subtitles_id);

-- 2. 대사 (자막 한 줄)
create table if not exists training.dialogues (
  id             bigint generated always as identity primary key,
  subtitles_id   bigint not null references training.subtitles(id) on delete cascade,
  scenes_id      bigint references training.scenes(id) on delete set null,
  line_index     int    not null,
  start_ms       int    not null,
  end_ms         int    not null,
  duration_ms    int    not null,
  text           text   not null,
  char_count     int    not null,
  word_count     int    not null,
  gap_before_ms  int,
  progress_ratio double precision not null,
  unique (subtitles_id, line_index)
);
create index if not exists dialogues_subtitles_id_idx on training.dialogues (subtitles_id);
create index if not exists dialogues_scenes_id_idx on training.dialogues (scenes_id);

-- 6. 모델 버전 레지스트리 (scene_scores가 참조하므로 먼저 생성)
create table if not exists training.model_versions (
  model_version text primary key,
  kind          text not null,
  description   text,
  metrics       jsonb,
  created_at    timestamptz not null default now()
);

-- 4. 씬 점수
create table if not exists training.scene_scores (
  id            bigint generated always as identity primary key,
  scenes_id     bigint not null references training.scenes(id) on delete cascade,
  score         double precision not null,
  model_version text not null references training.model_versions(model_version),
  created_at    timestamptz not null default now(),
  unique (scenes_id, model_version)
);
create index if not exists scene_scores_model_version_idx on training.scene_scores (model_version);

-- 5. 영화별 파이프라인 진행 상태
create table if not exists training.processing_status (
  tmdb_id        bigint primary key,
  subtitle_state text not null default 'pending',
  parse_state    text not null default 'pending',
  label_state    text not null default 'pending',
  score_state    text not null default 'pending',
  vector_state   text not null default 'pending',
  error          text,
  retry_count    int  not null default 0,
  updated_at     timestamptz not null default now()
);
