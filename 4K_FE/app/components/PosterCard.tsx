'use client';

// 영화 포스터 카드 — 3D 틸트 효과, glare, 선호/비선호 토글 포함
import { useState } from 'react';
import { Movie, posterUrl, genreList } from '@/app/lib/data';

interface PosterCardProps {
  movie: Movie;
  isHovered: boolean;
  onHover: (state: boolean) => void;
  onClick: () => void;
  pref: 'like' | 'dislike' | null;
  onTogglePref: (id: number, kind: 'like' | 'dislike') => void;
}

// 마우스 위치 기반 최대 회전각 (도)
const MAX_TILT = 14;

export default function PosterCard({
  movie,
  isHovered,
  onHover,
  onClick,
  pref,
  onTogglePref,
}: PosterCardProps) {
  const [rot, setRot] = useState({ x: 0, y: 0 });
  // glare 원의 중심점 — 마우스 위치에 따라 이동 (0~100%)
  const [glare, setGlare] = useState({ x: 50, y: 50 });

  const imgUrl = posterUrl(movie.poster_path);
  const genres = genreList(movie.genre);

  // 마우스 위치를 -0.5~0.5로 정규화하여 회전각과 glare 위치 계산
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
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        width: '100%',
        minWidth: 0,
        transform: `perspective(700px) rotateX(${rot.x}deg) rotateY(${rot.y}deg)`,
        transformStyle: 'preserve-3d',
        // hover 중에는 즉각 반응, 벗어날 때는 천천히 복귀
        transition: isHovered
          ? 'transform 0.08s linear'
          : 'transform 0.55s cubic-bezier(.2,.7,.2,1)',
        willChange: 'transform',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '2 / 3',
          borderRadius: 8,
          overflow: 'hidden',
          background: '#111218',
          boxShadow: isHovered
            ? '0 24px 60px -10px rgba(0,0,0,0.8), 0 0 0 1px color-mix(in oklch, var(--accent) 50%, transparent), 0 0 40px color-mix(in oklch, var(--accent) 20%, transparent)'
            : '0 8px 24px -8px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
          transition: 'box-shadow 0.35s',
        }}
      >
        {/* TMDB 포스터 이미지 */}
        {imgUrl ? (
          <img
            src={imgUrl}
            alt={movie.title}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        ) : (
          // 포스터 없을 때 fallback
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(155deg, #1a2840 0%, #0a1020 50%, #2a1810 100%)',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <span style={{ fontSize: 32 }}>🎬</span>
          </div>
        )}

        {/* glare — 마우스 위치를 따라 이동하는 반사광 */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `radial-gradient(circle at ${glare.x}% ${glare.y}%, rgba(255,255,255,0.13) 0%, transparent 60%)`,
            opacity: isHovered ? 1 : 0,
            transition: isHovered ? 'opacity 0.2s' : 'opacity 0.4s',
            pointerEvents: 'none',
          }}
        />

        {/* 연도 badge */}
        {movie.release_year && (
          <div style={{ position: 'absolute', top: 10, left: 10 }}>
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: 'rgba(255,255,255,0.65)',
                letterSpacing: '0.1em',
                fontFamily: 'var(--font-mono), monospace',
                background: 'rgba(0,0,0,0.55)',
                padding: '3px 7px',
                borderRadius: 3,
                backdropFilter: 'blur(4px)',
              }}
            >
              {movie.release_year}
            </span>
          </div>
        )}
      </div>

      {/* 포스터 하단 메타 — flex:1로 남은 높이 채워 버튼을 바닥에 고정 */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        <h3
          style={{
            fontSize: 14,
            fontWeight: 700,
            margin: 0,
            letterSpacing: '-0.01em',
            lineHeight: 1.25,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {movie.title}
        </h3>
        {/* 원제 없는 카드도 동일 높이를 유지하도록 빈 자리 확보 */}
        <div
          style={{
            fontSize: 11,
            color: 'rgba(255,255,255,0.4)',
            marginTop: 2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minHeight: '1.4em',
          }}
        >
          {movie.original_title && movie.original_title !== movie.title
            ? movie.original_title
            : ''}
        </div>
        <div
          style={{
            display: 'flex',
            gap: 6,
            marginTop: 5,
            alignItems: 'center',
            overflow: 'hidden',
          }}
        >
          {genres.slice(0, 2).map((g, i) => (
            <span
              key={g}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                flexShrink: 0,
              }}
            >
              {i > 0 && (
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>
                  ·
                </span>
              )}
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  color: 'rgba(255,255,255,0.55)',
                  letterSpacing: '0.04em',
                }}
              >
                {g}
              </span>
            </span>
          ))}
        </div>

        {/* 선호/비선호 버튼 — marginTop:auto로 항상 카드 바닥에 고정 */}
        <div
          style={{ display: 'flex', gap: 6, marginTop: 'auto', paddingTop: 8 }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePref(movie.tmdb_id, 'like');
            }}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              padding: '6px 0',
              background:
                pref === 'like'
                  ? 'color-mix(in oklch, var(--accent) 18%, transparent)'
                  : 'rgba(255,255,255,0.04)',
              border: `1px solid ${pref === 'like' ? 'color-mix(in oklch, var(--accent) 40%, transparent)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius: 6,
              color:
                pref === 'like' ? 'var(--accent)' : 'rgba(255,255,255,0.5)',
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill={pref === 'like' ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            선호
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePref(movie.tmdb_id, 'dislike');
            }}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              padding: '6px 0',
              background:
                pref === 'dislike'
                  ? 'rgba(255,90,40,0.12)'
                  : 'rgba(255,255,255,0.04)',
              border: `1px solid ${pref === 'dislike' ? 'rgba(255,110,60,0.35)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius: 6,
              color:
                pref === 'dislike'
                  ? 'rgb(255,130,80)'
                  : 'rgba(255,255,255,0.5)',
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill={pref === 'dislike' ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3z" />
            </svg>
            비선호
          </button>
        </div>
      </div>
    </article>
  );
}
