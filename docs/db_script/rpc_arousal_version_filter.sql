-- G(임베딩) 후속: vm4 추천 RPC가 movie_vectors에서 arousal 버전만 보도록 수정.
-- 배경: movie_vectors에 rule-v1 / roberta-va-v1::arousal / ::valence 가 공존하게 됨.
--       버전 필터가 없으면 추천(centroid/거리)이 여러 버전을 섞어 깨진다.
-- 적용: vm4(data.peakly.art) Supabase Studio → SQL Editor 에서 아래 실행.
--
-- 조사 결과(2026-06-15):
--   - movie_vectors 컬럼 = id, vector, vector_version, normalization,
--     smoothing_method, created_at, tmdb_id  (movies_id 컬럼 없음)
--   - find_similar_movies 는 존재하지 않는 mv.movies_id 를 참조 → 이미 깨진 상태이고
--     FE(fetchSimilarMovies)에서 미사용(죽은 코드) → 손대지 않음.
--   - 실제 사용/동작하는 추천 RPC = find_preferred_movies (tmdb_id 기반) → 이것만 수정.

-- ── find_preferred_movies: 모든 movie_vectors 참조에 arousal 버전 필터 추가 ──
CREATE OR REPLACE FUNCTION public.find_preferred_movies(like_ids integer[], dislike_ids integer[] DEFAULT ARRAY[]::integer[], match_count integer DEFAULT 400)
 RETURNS SETOF movies
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  like_vec vector;
  dislike_vec vector;
BEGIN
  IF array_length(like_ids, 1) > 0 THEN
    SELECT avg(vector) INTO like_vec
    FROM movie_vectors
    WHERE tmdb_id = ANY(like_ids)
      AND vector_version = 'roberta-va-v1::arousal';
  END IF;

  IF array_length(dislike_ids, 1) > 0 THEN
    SELECT avg(vector) INTO dislike_vec
    FROM movie_vectors
    WHERE tmdb_id = ANY(dislike_ids)
      AND vector_version = 'roberta-va-v1::arousal';
  END IF;

  IF like_vec IS NULL AND dislike_vec IS NULL THEN RETURN; END IF;

  -- 선호 + 비선호: like 거리 최소화 - 0.3 * dislike 거리 최소화
  IF like_vec IS NOT NULL AND dislike_vec IS NOT NULL THEN
    RETURN QUERY
      SELECT m.* FROM movies m
      JOIN movie_vectors mv
        ON mv.tmdb_id = m.tmdb_id AND mv.vector_version = 'roberta-va-v1::arousal'
      WHERE NOT (m.tmdb_id = ANY(like_ids)) AND NOT (m.tmdb_id = ANY(dislike_ids))
      ORDER BY (mv.vector <-> like_vec) - 0.3 * (mv.vector <-> dislike_vec) ASC
      LIMIT match_count;

  -- 선호만: like centroid와 가까운 순
  ELSIF like_vec IS NOT NULL THEN
    RETURN QUERY
      SELECT m.* FROM movies m
      JOIN movie_vectors mv
        ON mv.tmdb_id = m.tmdb_id AND mv.vector_version = 'roberta-va-v1::arousal'
      WHERE NOT (m.tmdb_id = ANY(like_ids))
      ORDER BY mv.vector <-> like_vec ASC
      LIMIT match_count;

  -- 비선호만: dislike centroid와 먼 순
  ELSE
    RETURN QUERY
      SELECT m.* FROM movies m
      JOIN movie_vectors mv
        ON mv.tmdb_id = m.tmdb_id AND mv.vector_version = 'roberta-va-v1::arousal'
      WHERE NOT (m.tmdb_id = ANY(dislike_ids))
      ORDER BY mv.vector <-> dislike_vec DESC
      LIMIT match_count;
  END IF;
END;
$function$;
