'use client';

import { Movie } from '@/app/lib/data';
import ClimaxGraph from './ClimaxGraph';
import PatternChip from './PatternChip';

interface PosterCardProps {
  movie: Movie;
  isHovered: boolean;
  onHover: (state: boolean) => void;
  onClick: () => void;
  pref: 'like' | 'dislike' | null;
  onTogglePref: (id: string, kind: 'like' | 'dislike') => void;
}

export default function PosterCard({ movie, isHovered, onHover, onClick, pref, onTogglePref }: PosterCardProps) {
  return (
    <article
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={onClick}
      style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <div style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '2 / 3',
        borderRadius: 8,
        overflow: 'hidden',
        background: movie.poster,
        boxShadow: isHovered
          ? '0 18px 50px -10px rgba(0,0,0,0.7), 0 0 0 1px color-mix(in oklch, var(--accent) 50%, transparent), 0 0 30px color-mix(in oklch, var(--accent) 25%, transparent)'
          : '0 8px 24px -8px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
        transform: isHovered ? 'translateY(-4px)' : 'translateY(0)',
        transition: 'transform 0.3s cubic-bezier(.2,.7,.2,1), box-shadow 0.3s',
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

        {/* title on poster — fades on hover */}
        <div style={{
          position: 'absolute', left: 12, right: 12, bottom: 14,
          color: movie.posterAccent,
          fontFamily: 'var(--font-playfair), serif',
          fontSize: 18,
          fontWeight: 800,
          lineHeight: 1.05,
          letterSpacing: '-0.01em',
          textShadow: '0 2px 12px rgba(0,0,0,0.7)',
          opacity: isHovered ? 0 : 1,
          transition: 'opacity 0.25s',
        }}>
          {movie.title}
        </div>

        {/* hover overlay: climax graph */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.85) 60%)',
          opacity: isHovered ? 1 : 0,
          transition: 'opacity 0.3s',
          pointerEvents: 'none',
          display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
          padding: 14,
        }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.18em', fontWeight: 700, marginBottom: 6 }}>CLIMAX GRAPH</div>
          <div style={{ height: 80, marginBottom: 8 }}>
            <ClimaxGraph data={movie.graph} color="var(--accent)" showHover={false} strokeWidth={2} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <PatternChip pattern={movie.pattern} active />
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontFamily: 'var(--font-mono), monospace' }}>{movie.runtime}min</span>
          </div>
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
