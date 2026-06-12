'use client';

// 영화 상세 오버레이 — 포스터, 시놉시스, 트레일러, 클라이맥스 그래프, 유사 영화 추천
import { useState, useEffect } from 'react';
import { Movie, posterUrl, genreList, castList, fetchVector, fetchPreferredMovies, fetchMovieVectors } from '@/app/lib/data';
import { cosineSimilarity, climaxMetrics, topPeaks } from '@/app/lib/climax';

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

  const metrics = vector ? climaxMetrics(vector) : null;
  const peaks = vector ? topPeaks(vector, 3) : [];

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

          {/* 클라이맥스 지표 + 그래프 + 피크 범례 */}
          <section style={{ marginTop: 40 }}>
            <h3 style={sectionLabel}>CLIMAX GRAPH</h3>

            {metrics && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 12 }}>
                {[
                  { k: '클라이맥스 강도', v: `${metrics.intensity}`, suf: ' / 10' },
                  { k: '절정 위치', v: `${metrics.peakPositionPct}%`, suf: ' 지점' },
                  { k: '긴장 피크', v: `${metrics.peakCount}`, suf: '회' },
                ].map((c) => (
                  <div key={c.k} style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '16px 18px' }}>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.12em', fontWeight: 700 }}>{c.k}</div>
                    <div style={{ marginTop: 8, fontFamily: 'var(--font-playfair), serif', fontWeight: 800, fontSize: 30, color: 'var(--fg)' }}>
                      {c.v}<span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.4)' }}>{c.suf}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{
              marginTop: 12, height: 300, borderRadius: 8,
              background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)',
              overflow: 'hidden',
              display: vectorLoading || !vector ? 'grid' : 'block',
              placeItems: 'center',
            }}>
              {vectorLoading ? (
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em' }}>로딩 중...</span>
              ) : vector ? (
                <ClimaxGraph data={vector} height={300} markers={peaks.map((p, i) => ({ index: p.index, label: String(i + 1) }))} />
              ) : (
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em' }}>준비중</span>
              )}
            </div>

            {vector && peaks.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginTop: 14 }}>
                {peaks.map((p, i) => (
                  <div key={p.index} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--accent)', color: '#0a0a0f', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 800 }}>{i + 1}</span>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{p.label} · 강도 {p.valuePct}%</span>
                  </div>
                ))}
              </div>
            )}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {similarLoading
                ? Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: 10, height: 72, opacity: 0.5 }} />
                  ))
                : similar.map(({ movie: m, vector: simVec, matchPct }) => {
                const simImg = posterUrl(m.poster_path);
                const simGenres = genreList(m.genre).slice(0, 2);
                return (
                  <button
                    key={m.tmdb_id}
                    onClick={() => onSelectMovie(m)}
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 10, padding: 12,
                      cursor: 'pointer', color: 'inherit', fontFamily: 'inherit', textAlign: 'left',
                      display: 'flex', gap: 14, alignItems: 'center',
                      transition: 'background 0.2s, border-color 0.2s',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.14)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.03)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.08)'; }}
                  >
                    {/* MATCH % */}
                    <div style={{ flexShrink: 0, width: 52, textAlign: 'center' }}>
                      <div style={{ fontFamily: 'var(--font-playfair), serif', fontWeight: 800, fontSize: 24, color: 'var(--accent)', lineHeight: 1 }}>{matchPct}</div>
                      <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.4)', marginTop: 3 }}>MATCH %</div>
                    </div>
                    {/* 포스터 */}
                    <div style={{ width: 44, flexShrink: 0, aspectRatio: '2/3', borderRadius: 6, overflow: 'hidden', background: '#111218', position: 'relative' }}>
                      {simImg ? (
                        <img src={simImg} alt={m.title} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}><span style={{ fontSize: 16 }}>🎬</span></div>
                      )}
                    </div>
                    {/* 제목·메타 */}
                    <div style={{ flexShrink: 0, width: 150, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 }}>{m.title}</div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 4 }}>
                        {m.release_year}{simGenres.length ? ` · ${simGenres.join(' · ')}` : ''}
                      </div>
                    </div>
                    {/* 미니그래프(해당 영화 실선 + 현재 영화 점선) */}
                    <div style={{ flex: 1, minWidth: 80, height: 48 }}>
                      <MiniGraph data={simVec} reference={vector ?? undefined} height={48} />
                    </div>
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
