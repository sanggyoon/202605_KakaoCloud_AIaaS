-- vm4(data) Row Level Security 강화 — anon 전체 읽기/쓰기/삭제 차단.
-- 배경: RLS 미적용으로 공개 anon 키만으로 api_keys/visits 읽기, movies 쓰기/삭제가 가능했음.
-- 원칙:
--   * service_role 은 RLS 를 우회(BYPASSRLS) → BE/매니저(서비스 키)는 영향 없음.
--   * validate_api_key() 는 SECURITY DEFINER → api_keys RLS 후에도 정상 동작.
--   * 공개 테이블은 anon SELECT 만 허용(쓰기 정책 없음 → anon INSERT/UPDATE/DELETE 차단).
--   * 민감 테이블은 anon 정책 없음 → 전면 차단.
-- 적용: Supabase Studio SQL editor 또는 psql(서비스 자격)로 실행.

-- ── 1) 공개 읽기 테이블: RLS on + anon SELECT 만 ──────────────────────────
alter table public.movies enable row level security;
drop policy if exists anon_select_movies on public.movies;
create policy anon_select_movies on public.movies
  for select to anon using (true);

alter table public.movie_vectors enable row level security;
drop policy if exists anon_select_movie_vectors on public.movie_vectors;
create policy anon_select_movie_vectors on public.movie_vectors
  for select to anon using (true);

alter table public.app_config enable row level security;
drop policy if exists anon_select_app_config on public.app_config;
create policy anon_select_app_config on public.app_config
  for select to anon using (true);

-- ── 2) 민감 테이블: RLS on + anon 정책 없음 → 전면 차단 ────────────────────
alter table public.api_keys enable row level security;
alter table public.visits  enable row level security;

-- ── 3) (선택) 방어심화: 민감 테이블의 anon 테이블 권한도 회수 ──────────────
-- RLS 만으로도 차단되지만(빈 결과/거부), 권한 자체를 제거하면 더 깔끔.
revoke all on table public.api_keys from anon;
revoke all on table public.visits  from anon;

-- ── 4) 검증: RLS 미적용 테이블이 더 없는지 점검 ───────────────────────────
-- 실행해서 rowsecurity=false 인 public 테이블이 있으면 추가 검토.
--   select schemaname, tablename, rowsecurity
--   from pg_tables where schemaname = 'public' order by rowsecurity, tablename;
