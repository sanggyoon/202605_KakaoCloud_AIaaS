-- data=public, ai=ai 스키마. anon/authenticated/service_role 권한.
-- (public usage는 supabase가 이미 부여. ai 스키마 usage는 새로 필요.)
-- 복원이 --no-privileges라 테이블 GRANT를 다시 줌. RLS 정책은 덤프에 포함되어 따라옴.

GRANT USAGE ON SCHEMA ai TO anon, authenticated, service_role;

-- 읽기(공개) — RLS가 행 단위로 추가 제어
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA ai     TO anon, authenticated;

-- 서비스 롤 전체 권한(RLS 우회)
GRANT ALL ON ALL TABLES    IN SCHEMA public, ai TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public, ai TO service_role;

-- RPC 실행 (find_preferred_movies, validate_api_key 등은 public)
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

-- 향후 객체 기본 권한
ALTER DEFAULT PRIVILEGES IN SCHEMA ai GRANT SELECT ON TABLES TO anon, authenticated;
