'use client';

import { useState } from 'react';
import { Movie, MOVIES } from '@/app/lib/data';
import ClimaxGraph from './ClimaxGraph';
import MiniGraph from './MiniGraph';
import Poster from './Poster';
import PatternChip from './PatternChip';

interface DetailOverlayProps {
  movie: Movie;
  onClose: () => void;
  onSelectMovie: (m: Movie) => void;
}

const sectionLabel: React.CSSProperties = {
  fontSize: 10, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.2em', fontWeight: 700, margin: 0,
};

export default function DetailOverlay({ movie, onClose, onSelectMovie }: DetailOverlayProps) {
  const similar = movie.similar.map((id) => MOVIES.find((m) => m.id === id)).filter((m): m is Movie => Boolean(m));
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(14px)',
      zIndex: 90, overflow: 'auto',
      animation: 'fadeIn 0.25s ease',
    }}>
      <div style={{ maxWidth: 1100, margin: '40px auto', padding: 32 }}>
        <button
          onClick={onClose}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, fontWeight: 600, fontSize: 12, cursor: 'pointer', marginBottom: 20, fontFamily: 'inherit' }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m15 18-6-6 6-6" />
          </svg>
          뒤로 가기
        </button>

        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 32 }}>
          <div>
            <Poster movie={movie} size="xl" />
          </div>

          <div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.2em', fontWeight: 700, marginBottom: 8 }}>
              {movie.year} · {movie.runtime}MIN
            </div>
            <h1 style={{ fontFamily: 'var(--font-playfair), serif', fontSize: 56, fontWeight: 800, margin: 0, letterSpacing: '-0.03em', lineHeight: 0.95, color: 'var(--fg)' }}>
              {movie.title}
            </h1>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', marginTop: 6 }}>{movie.titleKo}</div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <PatternChip pattern={movie.pattern} active />
              {movie.genre.map((g) => (
                <span key={g} style={{ padding: '5px 10px', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', borderRadius: 4, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>{g}</span>
              ))}
            </div>

            <section style={{ marginTop: 24 }}>
              <h3 style={sectionLabel}>SYNOPSIS</h3>
              <p style={{ fontSize: 14, lineHeight: 1.65, color: 'rgba(255,255,255,0.85)', margin: '10px 0 0' }}>{movie.synopsis}</p>
            </section>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 22 }}>
              <section>
                <h3 style={sectionLabel}>DIRECTOR</h3>
                <div style={{ fontSize: 14, marginTop: 8 }}>{movie.director}</div>
              </section>
              <section>
                <h3 style={sectionLabel}>CAST</h3>
                <div style={{ fontSize: 14, marginTop: 8, color: 'rgba(255,255,255,0.85)' }}>{movie.cast.join(', ')}</div>
              </section>
            </div>

            <section style={{ marginTop: 24 }}>
              <h3 style={sectionLabel}>TRAILER</h3>
              <div style={{
                marginTop: 10, height: 220, borderRadius: 10,
                background: movie.poster,
                position: 'relative', overflow: 'hidden',
                border: '1px solid rgba(255,255,255,0.08)',
                cursor: 'pointer',
              }}>
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.6))' }} />
                <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
                  <div style={{ width: 64, height: 64, borderRadius: 999, background: 'rgba(255,255,255,0.95)', display: 'grid', placeItems: 'center', boxShadow: '0 0 40px rgba(255,255,255,0.4)' }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="black"><path d="M8 5v14l11-7z" /></svg>
                  </div>
                </div>
                <div style={{ position: 'absolute', left: 16, bottom: 12, fontSize: 11, color: 'rgba(255,255,255,0.7)', letterSpacing: '0.1em' }}>
                  OFFICIAL TRAILER · 2:31
                </div>
              </div>
            </section>

            <section style={{ marginTop: 24 }}>
              <h3 style={sectionLabel}>CLIMAX GRAPH</h3>
              <div style={{ height: 180, marginTop: 10, padding: 8, background: 'rgba(0,0,0,0.3)', borderRadius: 8 }}>
                <ClimaxGraph data={movie.graph} onHover={setHoverIdx} color="var(--accent)" />
              </div>
              {hoverIdx !== null && (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--font-mono), monospace' }}>
                  {Math.floor((hoverIdx / 17) * movie.runtime)}분 · 긴장도 {movie.graph[hoverIdx]}/100
                </div>
              )}
            </section>

            <section style={{ marginTop: 24 }}>
              <h3 style={sectionLabel}>비슷한 패턴 추천</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 10 }}>
                {similar.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => onSelectMovie(m)}
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 8, padding: 10,
                      cursor: 'pointer', color: 'inherit', fontFamily: 'inherit', textAlign: 'left',
                      display: 'flex', gap: 10,
                    }}
                  >
                    <Poster movie={m} size="sm" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.title}</div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>{m.year}</div>
                      <div style={{ height: 18, marginTop: 4 }}><MiniGraph data={m.graph} height={18} /></div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
