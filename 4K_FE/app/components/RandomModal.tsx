'use client';

// 랜덤 영화 추천 모달 — 서버 전체 DB에서 random offset으로 1개 fetch, 80ms 셔플 애니메이션 병렬 진행
import { useEffect, useRef, useState, useCallback } from 'react';
import { Movie, posterUrl, genreList, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/app/lib/data';

interface RandomModalProps {
  movies: Movie[]; // 셔플 애니메이션 시각 효과용
  onClose: () => void;
  onPick: (m: Movie) => void;
}

async function fetchRandomFromServer(): Promise<Movie | null> {
  try {
    // total count 획득
    const countRes = await fetch(`${SUPABASE_URL}/rest/v1/movies?select=id`, {
      headers: { apikey: SUPABASE_ANON_KEY, 'Prefer': 'count=exact', 'Range': '0-0' },
    });
    const range = countRes.headers.get('Content-Range'); // "0-0/1234"
    const total = range ? parseInt(range.split('/')[1], 10) : 0;
    if (!total) return null;

    const offset = Math.floor(Math.random() * total);
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/movies?select=*&limit=1&offset=${offset}&order=id.asc`,
      { headers: { apikey: SUPABASE_ANON_KEY } },
    );
    const data: unknown = await res.json();
    return Array.isArray(data) && data.length > 0 ? (data[0] as Movie) : null;
  } catch {
    return null;
  }
}

export default function RandomModal({ movies, onClose, onPick }: RandomModalProps) {
  const [picked, setPicked] = useState<Movie | null>(movies[0] ?? null);
  const [shuffling, setShuffling] = useState(true);
  const [rolls, setRolls] = useState(0);

  // fetch 결과와 애니메이션 완료 여부를 ref로 공유 — 둘 다 준비되면 결과 확정
  const serverMovieRef = useRef<Movie | null>(null);
  const animDoneRef = useRef(false);

  const startFetch = useCallback(() => {
    serverMovieRef.current = null;
    animDoneRef.current = false;
    fetchRandomFromServer().then((movie) => {
      serverMovieRef.current = movie;
      if (animDoneRef.current) {
        if (movie) setPicked(movie);
        setShuffling(false);
      }
    });
  }, []);

  // 최초 마운트 시 서버 fetch 시작
  useEffect(() => {
    startFetch();
  }, [startFetch]);

  // 셔플 애니메이션 — 15회 후 fetch 완료 대기, 완료되면 결과 확정
  useEffect(() => {
    if (!shuffling) return;
    // movies 없으면 애니메이션 없이 fetch 완료만 기다림
    if (movies.length === 0) {
      animDoneRef.current = true;
      return;
    }
    let count = 0;
    let active = true;

    const id = setInterval(() => {
      if (!active) return;
      setPicked(movies[Math.floor(Math.random() * movies.length)]);
      setRolls(count);
      count++;

      if (count > 14) {
        animDoneRef.current = true;
        if (serverMovieRef.current) {
          active = false;
          clearInterval(id);
          setPicked(serverMovieRef.current);
          setShuffling(false);
        }
        // fetch 아직 진행 중이면 interval 계속 — fetch 완료 시 위 then() 콜백이 멈춤
      }
    }, 80);

    return () => {
      active = false;
      clearInterval(id);
    };
  }, [shuffling, movies]);

  const handleReroll = () => {
    setRolls(0);
    setShuffling(true);
    startFetch();
  };

  const imgUrl = picked ? posterUrl(picked.poster_path) : null;
  const genres = picked ? genreList(picked.genre).slice(0, 2) : [];

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'grid', placeItems: 'center', zIndex: 100, animation: 'fadeIn 0.2s ease' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="random-modal"
        style={{ background: 'linear-gradient(160deg, #14161c, #0a0b10)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, boxShadow: '0 30px 80px rgba(0,0,0,0.6)' }}
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
          <button
            onClick={handleReroll}
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
