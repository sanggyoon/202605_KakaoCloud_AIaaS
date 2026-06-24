-- svc/ai 스키마를 Supabase 기본 롤에 노출. service_role은 RLS 우회(BYPASSRLS).
-- RLS 정책은 덤프에 포함되어 따라옴(api_keys/visits anon 차단 유지) — 적용 후 확인.

GRANT USAGE ON SCHEMA svc, ai TO anon, authenticated, service_role;

-- 읽기(공개) — RLS가 행 단위로 추가 제어
GRANT SELECT ON ALL TABLES IN SCHEMA svc TO anon, authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA ai  TO anon, authenticated;

-- 서비스 롤 전체 권한
GRANT ALL ON ALL TABLES IN SCHEMA svc, ai TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA svc, ai TO service_role;

-- RPC 실행 (find_preferred_movies, validate_api_key 등은 svc)
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA svc TO anon, authenticated, service_role;

-- 앞으로 생성될 객체 기본 권한
ALTER DEFAULT PRIVILEGES IN SCHEMA svc GRANT SELECT ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA ai  GRANT SELECT ON TABLES TO anon, authenticated;

-- SECURITY DEFINER 함수의 search_path가 svc를 보도록(필요 시 함수 시그니처에 맞게):
--   ALTER FUNCTION svc.validate_api_key(text) SET search_path = svc;
--   ALTER FUNCTION svc.find_preferred_movies(int[], int[], int) SET search_path = svc, public, extensions;

-- 검증: RLS 켜진 테이블 확인
--   SELECT schemaname, tablename, rowsecurity FROM pg_tables
--   WHERE schemaname IN ('svc','ai') ORDER BY 1,3,2;
