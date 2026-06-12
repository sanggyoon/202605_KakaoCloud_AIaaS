'use client';

// 영화 상세 오버레이 — 포스터, 시놉시스, 트레일러, 클라이맥스 그래프, 유사 영화 추천
import { useState, useEffect } from 'react';
import { Movie, posterUrl, genreList, castList, fetchVector, fetchPreferredMovies, fetchMovieVectors } from '@/app/lib/data';
import { cosineSimilarity, climaxDescriptor } from '@/app/lib/climax';

import ClimaxGraph from '@/app/components/ClimaxGraph';
import MiniGraph from '@/app/components/MiniGraph';

interface DetailOverlayProps {
  movie: Movie;
  onClose: () => void;
  onSelectMovie: (m: Movie) => void;
}

const sectionLabel: React.CSSProperties = {
  fontSize: 10, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.2em', fontWeight: 700, margin: 0,
};

export default function DetailOverlay({ movie, onClose, onSelectMovie }: DetailOverlayProps) {
  const genres = genreList(movie.genre);
  const cast = castList(movie.actors);

  const [vector, setVector] = useState<number[] | null>(null);
  const [vectorLoading, setVectorLoading] = useState(true);
  const [similar, setSimilar] = useState<{ movie: Movie; vector: number[]; matchPct: number }[]>([]);
  const [similarLoading, setSimilarLoading] = useState(true);

  // ESC 키 → 오버레이 닫고 대시보드로 복귀
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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

      // 후보 벡터 일괄 fetch → 코사인 유사도 내림차순 상위 4
      const vecMap = await fetchMovieVectors(candidates.map((m: Movie) => m.tmdb_id));
      const ranked = candidates
        .map((m: Movie) => {
          const cv = vecMap.get(m.tmdb_id);
          return cv ? { movie: m, vector: cv, sim: cosineSimilarity(queryVec, cv) } : null;
        })
        .filter((x): x is { movie: Movie; vector: number[]; sim: number } => x !== null)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 4)
        .map((x) => ({ movie: x.movie, vector: x.vector, matchPct: Math.round(x.sim * 100) }));

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

        {/* 단일 컬럼 레이아웃 (포스터 없음) */}
        <div>
          {/* 메타 · 제목 · 장르 */}
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

          {/* 클라이맥스 곡선 */}
          <section style={{ marginTop: 40 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.28em', color: 'var(--accent)' }}>CLIMAX CURVE</span>
              <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, rgba(123,97,255,0.5), rgba(123,97,255,0))' }} />
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em' }}>자막·장면 AI 분석</span>
            </div>

            <div style={{
              marginTop: 18, height: 320, borderRadius: 12,
              background: 'radial-gradient(120% 100% at 70% 0%, rgba(123,97,255,0.10), rgba(0,0,0,0.35) 70%)',
              border: '1px solid rgba(255,255,255,0.06)',
              overflow: 'hidden',
              display: vectorLoading || !vector ? 'grid' : 'block',
              placeItems: 'center',
            }}>
              {vectorLoading ? (
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em' }}>로딩 중...</span>
              ) : vector ? (
                <ClimaxGraph data={vector} height={320} />
              ) : (
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em' }}>준비중</span>
              )}
            </div>
          </section>
        </div>

        {/* 비슷한 패턴의 영화 — 그래프(벡터)가 있는 영화만 표시 */}
        {!vectorLoading && vector !== null && (similarLoading || similar.length > 0) && (
          <section style={{ marginTop: 40 }}>
            <h3 style={{ ...sectionLabel, marginBottom: 16 }}>
              비슷한 패턴의 영화
              {!similarLoading && similar.length > 0 && vector && (
                <span style={{ marginLeft: 8, fontSize: 9, color: 'rgba(255,255,255,0.25)', fontWeight: 500, letterSpacing: '0.1em' }}>
                  · 클라이맥스 유사도 기반
                </span>
              )}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {similarLoading
                ? Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} style={{ height: 108, borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.06)', opacity: 0.4 }} />
                  ))
                : similar.map(({ movie: m, vector: simVec, matchPct }, idx) => {
                const simImg = posterUrl(m.poster_path);
                const simGenres = genreList(m.genre).slice(0, 2);
                const desc = climaxDescriptor(simVec);
                return (
                  <button
                    key={m.tmdb_id}
                    onClick={() => onSelectMovie(m)}
                    style={{
                      background: 'transparent', border: 'none',
                      borderTop: idx === 0 ? 'none' : '1px solid rgba(255,255,255,0.07)',
                      padding: '20px 4px',
                      cursor: 'pointer', color: 'inherit', fontFamily: 'inherit', textAlign: 'left',
                      display: 'flex', gap: 18, alignItems: 'center',
                      transition: 'background 0.2s',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.03)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                  >
                    {/* MATCH % */}
                    <div style={{ flexShrink: 0, width: 66, textAlign: 'center' }}>
                      <span style={{ fontFamily: 'var(--font-playfair), serif', fontWeight: 800, fontSize: 38, color: '#fff', lineHeight: 1 }}>{matchPct}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginLeft: 2 }}>%</span>
                    </div>
                    {/* 포스터 */}
                    <div style={{ width: 56, flexShrink: 0, aspectRatio: '2/3', borderRadius: 7, overflow: 'hidden', background: '#111218', position: 'relative' }}>
                      {simImg ? (
                        <img src={simImg} alt={m.title} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}><span style={{ fontSize: 18 }}>🎬</span></div>
                      )}
                    </div>
                    {/* 제목·메타(연도·장르·곡선 설명) */}
                    <div style={{ flexShrink: 0, width: 240, minWidth: 0 }}>
                      <div style={{ fontSize: 17, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 }}>{m.title}</div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.42)', marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {m.release_year}{simGenres.length ? ` · ${simGenres.join(' · ')}` : ''}{desc ? `  ·  ${desc}` : ''}
                      </div>
                    </div>
                    {/* 미니그래프 */}
                    <div style={{ flex: 1, minWidth: 80, height: 60 }}>
                      <MiniGraph data={simVec} height={60} />
                    </div>
                    {/* chevron */}
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" style={{ flexShrink: 0 }}>
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* 줄거리 */}
        {movie.overview && (
          <section style={{ marginTop: 40 }}>
            <h3 style={sectionLabel}>SYNOPSIS</h3>
            <p style={{ fontSize: 14, lineHeight: 1.65, color: 'rgba(255,255,255,0.85)', margin: '10px 0 0', maxWidth: 760 }}>{movie.overview}</p>
          </section>
        )}

        {/* 감독 · 배우 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 32 }}>
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
        <section style={{ marginTop: 40 }}>
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
      </div>
    </div>
  );
}
