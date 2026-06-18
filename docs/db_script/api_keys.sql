-- 고객별 API 키 — vm4(data.peakly.art)에서 실행.
-- 평문 키는 저장하지 않고 sha-256 hex(소문자)만 저장한다.

create table if not exists api_keys (
  id           bigint generated always as identity primary key,
  name         text   not null,            -- 고객/용도 식별 라벨
  key_hash     text   not null unique,      -- sha-256 hex(소문자)
  key_prefix   text   not null,            -- 평문 앞 12자 (목록 식별용)
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

-- 검증 RPC: 해시 1건을 조회·갱신. SECURITY DEFINER라 호출자(anon)가
-- 테이블을 직접 못 읽어도 이 함수로는 유효성만 확인할 수 있다.
create or replace function validate_api_key(p_hash text)
returns table (name text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    update api_keys
       set last_used_at = now()
     where key_hash = p_hash and active = true
    returning api_keys.name;
end;
$$;

revoke all on function validate_api_key(text) from public;
grant execute on function validate_api_key(text) to anon;
