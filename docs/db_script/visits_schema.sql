-- 공개 서비스 방문 기록. 브라우저당 하루 1행(FE에서 스로틀).
-- 운영 Supabase(data.peakly.art)에 수동 적용한다.
create table if not exists visits (
  id         bigint generated always as identity primary key,
  visitor_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists visits_created_at_idx on visits (created_at);
