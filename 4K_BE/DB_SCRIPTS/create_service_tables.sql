-- ============================================================
-- Data Supabase (vm4) — service 테이블 생성
-- 실행 위치: data.4kakao.kro.kr Studio > SQL Editor
-- ============================================================

-- pgvector extension (movie_vectors 테이블용)
CREATE EXTENSION IF NOT EXISTS vector;


-- ────────────────────────────────────────────────────────────
-- 1. movies
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS movies (
    id             BIGSERIAL                PRIMARY KEY,
    tmdb_id        BIGINT                   NOT NULL UNIQUE,
    imdb_id        VARCHAR(30),
    title          VARCHAR(255),
    original_title VARCHAR(255),
    poster_path    VARCHAR(255),
    director       VARCHAR(255),
    release_year   INT,
    runtime        INT,
    genre          VARCHAR(255),
    actors         VARCHAR(500),
    overview       TEXT,
    youtube_key    VARCHAR(50),
    created_at     TIMESTAMPTZ              DEFAULT NOW()
);

-- tmdb_id 검색 인덱스 (seed 스크립트 중복 체크, FE 조회 모두 사용)
CREATE INDEX IF NOT EXISTS idx_movies_tmdb_id ON movies(tmdb_id);


-- ────────────────────────────────────────────────────────────
-- 2. movie_vectors
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS movie_vectors (
    id               BIGSERIAL   PRIMARY KEY,
    movies_id        BIGINT      NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    vector           VECTOR(200) NOT NULL,
    vector_version   VARCHAR(50),
    normalization    VARCHAR(50),
    smoothing_method VARCHAR(50),
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_movie_vectors_movies_id ON movie_vectors(movies_id);

-- 벡터 유사도 검색 인덱스 (cosine)
-- 데이터가 충분히 쌓인 뒤 실행 (IVFFlat은 최소 수백 행 필요)
-- lists 값 기준: row 수 / 1000 ~ sqrt(row 수) 사이 권장
-- CREATE INDEX idx_movie_vectors_ivfflat
--     ON movie_vectors USING ivfflat (vector vector_cosine_ops)
--     WITH (lists = 20);


-- ────────────────────────────────────────────────────────────
-- 3. RLS (Row Level Security)
-- ────────────────────────────────────────────────────────────
-- Supabase는 기본적으로 RLS가 활성화됨.
-- seed 스크립트는 service_role 키를 사용하므로 RLS 무시됨.
-- FE(anon 키)에서 읽기 허용하려면 아래 정책 추가:

ALTER TABLE movies       ENABLE ROW LEVEL SECURITY;
ALTER TABLE movie_vectors ENABLE ROW LEVEL SECURITY;

-- anon / authenticated 모두 읽기 허용
CREATE POLICY "movies_read" ON movies
    FOR SELECT USING (true);

CREATE POLICY "movie_vectors_read" ON movie_vectors
    FOR SELECT USING (true);

-- 쓰기는 service_role만 (정책 없음 = service_role만 가능)


-- ────────────────────────────────────────────────────────────
-- 확인 쿼리
-- ────────────────────────────────────────────────────────────
-- SELECT COUNT(*) FROM movies;
-- SELECT * FROM movies LIMIT 5;
