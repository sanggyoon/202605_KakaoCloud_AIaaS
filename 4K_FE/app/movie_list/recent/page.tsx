'use client';

// 최근 추가 데이터 — created_at 내림차순으로 최근 채워진 영화 확인
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { posterUrl } from '@/app/lib/data';

interface RecentMovie {
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  release_year: number | null;
  has_vector: boolean;
  created_at: string;
}

export default function RecentPage() {
  const router = useRouter();
  const [movies, setMovies] = useState<RecentMovie[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/manager/movies/recent?limit=100');
        const data = await res.json();
        setMovies(data.movies ?? []);
      } catch {
        setMovies([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <main style={{ padding: '24px', maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 22 }}>최근 추가 데이터</h1>
        <button
          onClick={() => router.push('/movie_list')}
          style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}
        >
          ← 영화 관리로
        </button>
      </div>

      {loading ? (
        <p style={{ marginTop: 24, opacity: 0.6 }}>불러오는 중...</p>
      ) : movies.length === 0 ? (
        <p style={{ marginTop: 24, opacity: 0.6 }}>최근 추가된 영화가 없습니다.</p>
      ) : (
        <table style={{ width: '100%', marginTop: 16, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', opacity: 0.6, fontSize: 13 }}>
              <th style={{ padding: '8px 6px' }}>포스터</th>
              <th style={{ padding: '8px 6px' }}>제목</th>
              <th style={{ padding: '8px 6px' }}>연도</th>
              <th style={{ padding: '8px 6px' }}>벡터</th>
              <th style={{ padding: '8px 6px' }}>추가 시각</th>
            </tr>
          </thead>
          <tbody>
            {movies.map((m) => (
              <tr key={m.tmdb_id} style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <td style={{ padding: '6px' }}>
                  {m.poster_path ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={posterUrl(m.poster_path) ?? undefined} alt={m.title} width={40} style={{ borderRadius: 4 }} />
                  ) : '—'}
                </td>
                <td style={{ padding: '6px' }}>{m.title}</td>
                <td style={{ padding: '6px' }}>{m.release_year ?? '—'}</td>
                <td style={{ padding: '6px' }}>
                  <span style={{
                    fontSize: 12,
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: m.has_vector ? 'rgba(34,197,94,0.85)' : 'rgba(255,255,255,0.08)',
                    color: m.has_vector ? 'black' : 'rgba(255,255,255,0.5)',
                  }}>
                    {m.has_vector ? '추천 가능' : '메타만'}
                  </span>
                </td>
                <td style={{ padding: '6px', fontSize: 13, opacity: 0.7 }}>
                  {new Date(m.created_at).toLocaleString('ko-KR')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
