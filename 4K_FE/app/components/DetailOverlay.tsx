'use client';

// 영화 상세 오버레이 — 포스터, 시놉시스, 트레일러, 클라이맥스 그래프, 유사 영화 추천
import { useState, useEffect } from 'react';
import { Movie, posterUrl, genreList, castList, fetchVector, fetchPreferredMovies, fetchMovieVectors } from '@/app/lib/data';

// DTW distance: Float64Array 플랫 배열로 메모리 효율화, O(n*m) 시간
function dtwDistance(a: number[], b: number[]): number {
  const n = a.length, m = b.length;
  const INF = Infinity;
  const dp = new Float64Array((n + 1) * (m + 1)).fill(INF);
  dp[0] = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = (a[i - 1] - b[j - 1]) ** 2;
      dp[i * (m + 1) + j] = cost + Math.min(
        dp[(i - 1) * (m + 1) + j],
        dp[i * (m + 1) + (j - 1)],
        dp[(i - 1) * (m + 1) + (j - 1)],
      );
    }
  }
  return Math.sqrt(dp[n * (m + 1) + m]);
}
import ClimaxGraph from '@/app/components/ClimaxGraph';

interface DetailOverlayProps {
  movie: Movie;
  onClose: () => void;
  onSelectMovie: (m: Movie) => void;
}

const sectionLabel: React.CSSProperties = {
  fontSize: 10, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.2em', fontWeight: 700, margin: 0,
};

export default function DetailOverlay({ movie, onClose, onSelectMovie }: DetailOverlayProps) {
  const imgUrl = posterUrl(movie.poster_path);
  const genres = genreList(movie.genre);
  const cast = castList(movie.actors);

  const [vector, setVector] = useState<number[] | null>(null);
  const [vectorLoading, setVectorLoading] = useState(true);
  const [similar, setSimilar] = useState<Movie[]>([]);
  const [similarLoading, setSimilarLoading] = useState(true);

  // 영화가 바뀔 때마다 벡터 + 유사 영화 fetch
  // pgvector 50개 후보 → 벡터 일괄 fetch → DTW 정밀 비교 → 상위 4개
  useEffect(() => {
    setVector(null);
    setVectorLoading(true);
    setSimilar([]);
    setSimilarLoading(true);

    Promise.all([
      fetchVector(movie.tmdb_id),
      fetchPreferredMovies([movie.tmdb_id], [], 50),
    ]).then(async ([queryVec, rawCandidates]) => {
      setVector(queryVec);
      setVectorLoading(false);

      // 현재 영화 자신은 후보에서 제외
      const candidates = rawCandidates.filter((m: Movie) => m.tmdb_id !== movie.tmdb_id);

      if (candidates.length === 0) {
        setSimilarLoading(false);
        return;
      }

      if (!queryVec) {
        setSimilar([]);
        setSimilarLoading(false);
        return;
      }

      // 후보 벡터 일괄 fetch → DTW 정렬 (벡터 없는 후보는 Infinity로 후순위)
      const vecMap = await fetchMovieVectors(candidates.map((m: Movie) => m.tmdb_id));
      const ranked = candidates
        .map((m: Movie) => ({
          movie: m,
          dist: vecMap.has(m.tmdb_id) ? dtwDistance(queryVec, vecMap.get(m.tmdb_id)!) : Infinity,
        }))
        .sort((a: { dist: number }, b: { dist: number }) => a.dist - b.dist)
        .slice(0, 4)
        .map((x: { movie: Movie }) => x.movie);

      setSimilar(ranked);
      setSimilarLoading(false);
    });
  }, [movie.id]);

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(14px)',
      zIndex: 90, overflow: 'auto',
      animation: 'fadeIn 0.25s ease',
    }}>
      <div className="detail-container">
        <button
          onClick={onClose}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, fontWeight: 600, fontSize: 12, cursor: 'pointer', marginBottom: 20, fontFamily: 'inherit' }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m15 18-6-6 6-6" />
          </svg>
          뒤로 가기
        </button>

        <div className="detail-layout">
          {/* Poster */}
          <div style={{ position: 'relative', width: '100%', aspectRatio: '2 / 3', borderRadius: 10, overflow: 'hidden', background: '#111218', flexShrink: 0 }}>
            {imgUrl ? (
              <img src={imgUrl} alt={movie.title} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(155deg, #1a2840 0%, #0a1020 50%, #2a1810 100%)', display: 'grid', placeItems: 'center' }}>
                <span style={{ fontSize: 48 }}>🎬</span>
              </div>
            )}
          </div>

          <div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.2em', fontWeight: 700, marginBottom: 8 }}>
              {movie.release_year}{movie.runtime ? ` · ${movie.runtime}MIN` : ''}
            </div>
            <h1 className="detail-title" style={{ fontFamily: 'var(--font-playfair), serif', fontWeight: 800, margin: 0, letterSpacing: '-0.03em', color: 'var(--fg)' }}>
              {movie.title}
            </h1>
            {movie.original_title && movie.original_title !== movie.title && (
              <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', marginTop: 6 }}>{movie.original_title}</div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              {genres.map((g) => (
                <span key={g} style={{ padding: '5px 10px', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', borderRadius: 4, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>{g}</span>
              ))}
            </div>

            {movie.overview && (
              <section style={{ marginTop: 24 }}>
                <h3 style={sectionLabel}>SYNOPSIS</h3>
                <p style={{ fontSize: 14, lineHeight: 1.65, color: 'rgba(255,255,255,0.85)', margin: '10px 0 0' }}>{movie.overview}</p>
              </section>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 22 }}>
              {movie.director && (
                <section>
                  <h3 style={sectionLabel}>DIRECTOR</h3>
                  <div style={{ fontSize: 14, marginTop: 8 }}>{movie.director}</div>
                </section>
              )}
              {cast.length > 0 && (
                <section>
                  <h3 style={sectionLabel}>CAST</h3>
                  <div style={{ fontSize: 14, marginTop: 8, color: 'rgba(255,255,255,0.85)' }}>{cast.join(', ')}</div>
                </section>
              )}
            </div>

            {/* 트레일러 — youtube_key 없으면 준비중 플레이스홀더로 동일 영역 유지 */}
            <section style={{ marginTop: 24 }}>
              <h3 style={sectionLabel}>TRAILER</h3>
              <div style={{ marginTop: 10, position: 'relative', paddingBottom: '56.25%', borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
                {movie.youtube_key ? (
                  <iframe
                    src={`https://www.youtube.com/embed/${movie.youtube_key}`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
                  />
                ) : (
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.02)', display: 'grid', placeItems: 'center' }}>
                    <div style={{ textAlign: 'center' }}>
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" style={{ display: 'block', margin: '0 auto 10px' }}>
                        <circle cx="12" cy="12" r="10" />
                        <path d="M10 8l6 4-6 4V8z" />
                      </svg>
                      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.1em' }}>준비중</span>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* 클라이맥스 그래프 — 자막 분석 기반 긴장감 곡선 */}
            <section style={{ marginTop: 24 }}>
              <h3 style={sectionLabel}>CLIMAX GRAPH</h3>
              <div style={{
                marginTop: 10, height: 180, borderRadius: 8,
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.06)',
                overflow: 'hidden',
                display: vectorLoading || !vector ? 'grid' : 'block',
                placeItems: 'center',
              }}>
                {vectorLoading ? (
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em' }}>로딩 중...</span>
                ) : vector ? (
                  <ClimaxGraph data={vector} height={180} />
                ) : (
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em' }}>준비중</span>
                )}
              </div>
            </section>
          </div>
        </div>

        {/* 비슷한 패턴의 영화 — 그래프(벡터)가 있는 영화만 표시 */}
        {!vectorLoading && vector !== null && (similarLoading || similar.length > 0) && (
          <section style={{ marginTop: 48 }}>
            <h3 style={{ ...sectionLabel, marginBottom: 16 }}>
              비슷한 패턴의 영화
              {!similarLoading && similar.length > 0 && vector && (
                <span style={{ marginLeft: 8, fontSize: 9, color: 'rgba(255,255,255,0.25)', fontWeight: 500, letterSpacing: '0.1em' }}>
                  · 클라이맥스 유사도 기반
                </span>
              )}
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-[18px]">
              {similarLoading
                ? Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="min-h-[124px] rounded-[18px] border border-white/[0.06] bg-white/[0.03] p-[clamp(14px,2vw,20px)] opacity-50"/>
                  ))
                : similar.map((m) => {
                const simImg = posterUrl(m.poster_path);
                const simGenres = genreList(m.genre).slice(0, 2);
                return (
                  <button
                    key={m.tmdb_id}
                    onClick={() => onSelectMovie(m)}
                    className="
                      grid min-h-[124px]
                      grid-cols-[clamp(72px,18vw,100px)_minmax(0,1fr)]
                      items-center gap-[clamp(12px,2vw,22px)]
                      rounded-[18px] border border-white/[0.08]
                      bg-white/[0.03]
                      p-[clamp(14px,2vw,20px)]
                      text-left font-[inherit] text-inherit
                      transition-colors duration-200
                      hover:border-white/[0.14] hover:bg-white/[0.06]
                    "
                  >
                    <div className="relative aspect-[2/3] w-full overflow-hidden rounded-[10px] bg-[#111218]">
                      {simImg ? (
                        <img
                          src={simImg}
                          alt={m.title}
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      ) : (
                        <div className="absolute inset-0 grid place-items-center">
                          <span className="text-lg">🎬</span>
                        </div>
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="line-clamp-2 break-keep text-[clamp(16px,2vw,22px)] font-extrabold leading-[1.25]">
                        {m.title}
                      </div>

                      <div className="mt-1.5 truncate text-[clamp(13px,1.5vw,16px)] leading-[1.4] text-white/45">
                        {m.release_year}
                      </div>

                      <div className="mt-1.5 truncate text-[clamp(13px,1.5vw,16px)] leading-[1.4] text-white/40">
                        {simGenres.join(' · ')}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>  {/* similar movies grid */}
          </section>
        )}
      </div>
    </div>
  );
}
