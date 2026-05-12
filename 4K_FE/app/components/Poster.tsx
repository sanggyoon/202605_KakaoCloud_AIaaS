'use client';

import { mockMovies } from './lib/data';

type PosterSize = 'sm' | 'md' | 'lg' | 'xl';

interface PosterProps {
  movie: Movie;
  size?: PosterSize;
}

const SIZES = {
  sm: { w: 64, h: 96, title: 9, year: 7 },
  md: { w: 120, h: 180, title: 13, year: 9 },
  lg: { w: 180, h: 270, title: 17, year: 11 },
  xl: { w: 240, h: 360, title: 22, year: 13 },
};

export default function Poster({ movie, size = 'md' }: PosterProps) {
  const s = SIZES[size];
  return (
    <div style={{
      width: s.w,
      height: s.h,
      borderRadius: 6,
      background: movie.poster,
      position: 'relative',
      overflow: 'hidden',
      flexShrink: 0,
      boxShadow: '0 8px 24px -8px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)',
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: `radial-gradient(ellipse at 30% 20%, ${movie.posterAccent}33 0%, transparent 50%)`,
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(180deg, transparent 30%, rgba(0,0,0,0.7) 100%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', left: 8, right: 8, bottom: 7,
        color: movie.posterAccent,
        fontFamily: 'var(--font-playfair), "Times New Roman", serif',
        fontSize: s.title,
        fontWeight: 700,
        lineHeight: 1.05,
        letterSpacing: '-0.01em',
        textShadow: '0 2px 8px rgba(0,0,0,0.6)',
      }}>
        {movie.title}
      </div>
      <div style={{
        position: 'absolute', left: 8, top: 7,
        color: 'rgba(255,255,255,0.5)',
        fontSize: s.year,
        fontWeight: 500,
        letterSpacing: '0.1em',
        fontFamily: 'var(--font-mono), monospace',
      }}>
        {movie.year}
      </div>
    </div>
  );
}
