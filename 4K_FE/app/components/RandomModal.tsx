'use client';

// 랜덤 영화 추천 모달 — 80ms 간격으로 15번 셔플 애니메이션 후 최종 선택 확정
import { useEffect, useState } from 'react';
import { Movie, posterUrl, genreList } from '@/app/lib/data';

interface RandomModalProps {
  movies: Movie[];
  onClose: () => void;
  onPick: (m: Movie) => void;
}

export default function RandomModal({ movies, onClose, onPick }: RandomModalProps) {
  const [picked, setPicked] = useState<Movie | null>(null);
  const [shuffling, setShuffling] = useState(true);
  const [rolls, setRolls] = useState(0);

  // 80ms마다 랜덤 영화로 교체 — 15회 후 멈춰 최종 결과 확정
  useEffect(() => {
    if (!shuffling || movies.length === 0) return;
    let count = 0;
    const id = setInterval(() => {
      const random = movies[Math.floor(Math.random() * movies.length)];
      setPicked(random);
      setRolls(count);
      count++;
      if (count > 14) {
        clearInterval(id);
        setShuffling(false);
      }
    }, 80);
    return () => clearInterval(id);
  }, [shuffling, movies]);

  const imgUrl = picked ? posterUrl(picked.poster_path) : null;
  const genres = picked ? genreList(picked.genre).slice(0, 2) : [];

  return (
    // 모달 외부 클릭 시 닫기
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'grid', placeItems: 'center', zIndex: 100, animation: 'fadeIn 0.2s ease' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 440, padding: 28, background: 'linear-gradient(160deg, #14161c, #0a0b10)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, boxShadow: '0 30px 80px rgba(0,0,0,0.6)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.2em', color: 'var(--accent)', fontWeight: 700 }}>RANDOM PICK</div>
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: '4px 0 0', letterSpacing: '-0.02em', color: 'var(--fg)' }}>
              {shuffling ? '고르는 중…' : '오늘의 영화'}
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{ width: 32, height: 32, borderRadius: 999, background: 'rgba(255,255,255,0.06)', border: 'none', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {picked && (
          // 셔플 중에는 좌우 흔들림 + 축소 — rolls 홀짝으로 방향 교대
          <div style={{
            display: 'grid', gridTemplateColumns: '120px 1fr', gap: 18,
            transform: shuffling ? `rotate(${rolls % 2 === 0 ? -2 : 2}deg) scale(0.96)` : 'rotate(0) scale(1)',
            transition: 'transform 0.2s ease',
            opacity: shuffling ? 0.6 : 1,
          }}>
            <div style={{ aspectRatio: '2/3', borderRadius: 8, overflow: 'hidden', background: '#111218', position: 'relative' }}>
              {imgUrl ? (
                <img src={imgUrl} alt={picked.title} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
                  <span style={{ fontSize: 32 }}>🎬</span>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h3 style={{ fontSize: 20, fontWeight: 800, margin: 0, letterSpacing: '-0.02em', lineHeight: 1.15, color: 'var(--fg)' }}>
                {picked.title}
              </h3>
              {picked.original_title && picked.original_title !== picked.title && (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>{picked.original_title}</div>
              )}
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>
                {picked.release_year}{picked.runtime ? ` · ${picked.runtime}분` : ''}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {genres.map((g) => (
                  <span key={g} style={{ padding: '4px 9px', fontSize: 10, fontWeight: 600, borderRadius: 4, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)' }}>{g}</span>
                ))}
              </div>
              {picked.director && (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>감독 {picked.director}</div>
              )}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
          {/* 셔플 중에는 비활성화 */}
          <button
            onClick={() => { setPicked(null); setShuffling(true); }}
            disabled={shuffling}
            style={{ flex: 1, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, fontWeight: 600, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', opacity: shuffling ? 0.5 : 1 }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
            </svg>
            다시 뽑기
          </button>
          <button
            onClick={() => picked && onPick(picked)}
            disabled={shuffling}
            style={{ flex: 1, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', background: 'var(--accent)', color: 'black', border: 'none', borderRadius: 7, fontWeight: 700, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', opacity: shuffling ? 0.5 : 1 }}
          >
            상세보기 →
          </button>
        </div>
      </div>
    </div>
  );
}
