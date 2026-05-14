'use client';

import { useState } from 'react';
import { Movie } from '@/app/lib/data';

interface PosterCardProps {
  movie: Movie;
  isHovered: boolean;
  onHover: (state: boolean) => void;
  onClick: () => void;
  pref: 'like' | 'dislike' | null;
  onTogglePref: (id: string, kind: 'like' | 'dislike') => void;
}

const MAX_TILT = 14;

export default function PosterCard({ movie, isHovered, onHover, onClick, pref, onTogglePref }: PosterCardProps) {
  const [rot, setRot] = useState({ x: 0, y: 0 });
  const [glare, setGlare] = useState({ x: 50, y: 50 });

  function handleMouseMove(e: React.MouseEvent<HTMLElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;
    setRot({ x: -ny * MAX_TILT, y: nx * MAX_TILT });
    setGlare({ x: (nx + 0.5) * 100, y: (ny + 0.5) * 100 });
  }

  function handleMouseLeave() {
    setRot({ x: 0, y: 0 });
    setGlare({ x: 50, y: 50 });
    onHover(false);
  }

  return (
    <article
      onMouseEnter={() => onHover(true)}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
      onClick={onClick}
      style={{
        cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10,
        transform: `perspective(700px) rotateX(${rot.x}deg) rotateY(${rot.y}deg)`,
        transformStyle: 'preserve-3d',
        transition: isHovered ? 'transform 0.08s linear' : 'transform 0.55s cubic-bezier(.2,.7,.2,1)',
        willChange: 'transform',
      }}
    >
      <div style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '2 / 3',
        borderRadius: 8,
        overflow: 'hidden',
        background: movie.poster,
        boxShadow: isHovered
          ? '0 24px 60px -10px rgba(0,0,0,0.8), 0 0 0 1px color-mix(in oklch, var(--accent) 50%, transparent), 0 0 40px color-mix(in oklch, var(--accent) 20%, transparent)'
          : '0 8px 24px -8px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
        transition: 'box-shadow 0.35s',
      }}>
        {/* spotlight */}
        <div style={{
          position: 'absolute', inset: 0,
          background: `radial-gradient(ellipse at 30% 20%, ${movie.posterAccent}33 0%, transparent 50%)`,
          pointerEvents: 'none',
        }} />
        {/* gradient bottom */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.55) 100%)',
          pointerEvents: 'none',
        }} />
        {/* glare — follows mouse */}
        <div style={{
          position: 'absolute', inset: 0,
          background: `radial-gradient(circle at ${glare.x}% ${glare.y}%, rgba(255,255,255,0.13) 0%, transparent 60%)`,
          opacity: isHovered ? 1 : 0,
          transition: isHovered ? 'opacity 0.2s' : 'opacity 0.4s',
          pointerEvents: 'none',
        }} />
        {/* year badge */}
        <div style={{ position: 'absolute', top: 10, left: 10 }}>
          <span style={{
            fontSize: 9, fontWeight: 600,
            color: 'rgba(255,255,255,0.65)',
            letterSpacing: '0.1em',
            fontFamily: 'var(--font-mono), monospace',
            background: 'rgba(0,0,0,0.4)',
            padding: '3px 7px',
            borderRadius: 3,
            backdropFilter: 'blur(4px)',
          }}>{movie.year}</span>
        </div>

        {/* title on poster */}
        <div style={{
          position: 'absolute', left: 12, right: 12, bottom: 14,
          color: movie.posterAccent,
          fontFamily: 'var(--font-playfair), serif',
          fontSize: 18,
          fontWeight: 800,
          lineHeight: 1.05,
          letterSpacing: '-0.01em',
          textShadow: '0 2px 12px rgba(0,0,0,0.7)',
        }}>
          {movie.title}
        </div>
      </div>

      {/* below poster */}
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, letterSpacing: '-0.01em', lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {movie.title}
        </h3>
        <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap', alignItems: 'center' }}>
          {movie.genre.map((g, i) => (
            <span key={g} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {i > 0 && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>·</span>}
              <span style={{ fontSize: 10, fontWeight: 500, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.04em' }}>{g}</span>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
          <button
            onClick={(e) => { e.stopPropagation(); onTogglePref(movie.id, 'like'); }}
            style={{
              flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              padding: '6px 10px',
              background: pref === 'like' ? 'color-mix(in oklch, var(--accent) 18%, transparent)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${pref === 'like' ? 'color-mix(in oklch, var(--accent) 40%, transparent)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius: 6,
              color: pref === 'like' ? 'var(--accent)' : 'rgba(255,255,255,0.7)',
              fontSize: 10, fontWeight: 600, fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill={pref === 'like' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            선호
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onTogglePref(movie.id, 'dislike'); }}
            style={{
              flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              padding: '6px 10px',
              background: pref === 'dislike' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${pref === 'dislike' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius: 6,
              color: pref === 'dislike' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.5)',
              fontSize: 10, fontWeight: 600, fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill={pref === 'dislike' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
              <path d="M17 14V2H7l-3 7v5h6l-1 7 8-7z" transform="rotate(180 12 12)" />
            </svg>
            비선호
          </button>
        </div>
      </div>
    </article>
  );
}
