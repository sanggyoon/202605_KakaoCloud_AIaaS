'use client';

// 영화 관리 페이지 — TMDB 최신 영화 목록, Supabase DB 존재 여부 확인, 추가/삭제
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { posterUrl } from '@/app/lib/data';
import MovieDetailModal from '@/app/components/MovieDetailModal';

interface ManagerMovie {
  tmdb_id: number;
  title: string;
  original_title: string;
  poster_path: string | null;
  release_date: string;
  overview: string;
  in_db: boolean;
}

export default function MovieListPage() {
  const router = useRouter();
  const [movies, setMovies] = useState<ManagerMovie[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  // 요청 중인 tmdb_id 집합 — 버튼 중복 클릭 방지
  const [pending, setPending] = useState<Set<number>>(new Set());
  // 검색어 입력값(query)과 실제 적용된 검색어(activeQuery)를 분리
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  // 상세/편집 모달 대상
  const [detail, setDetail] = useState<{ tmdb_id: number; title: string } | null>(null);

  const fetchMovies = useCallback(async (p: number, q: string) => {
    setLoading(true);
    try {
      const url = q.trim()
        ? `/api/manager/movies/search?q=${encodeURIComponent(q)}&page=${p}`
        : `/api/manager/movies?page=${p}`;
      const res = await fetch(url);
      const data = await res.json();
      setMovies(data.movies ?? []);
      setTotalPages(data.total_pages ?? 1);
    } catch {
      setMovies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMovies(page, activeQuery);
  }, [page, activeQuery, fetchMovies]);

  // 검색 실행 — 1페이지로 리셋하며 activeQuery 갱신
  const runSearch = (q: string) => {
    setPage(1);
    setActiveQuery(q.trim());
  };

  // 로그아웃 — 세션 쿠키 삭제 후 로그인 페이지로
  const handleLogout = async () => {
    await fetch('/api/manager/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  };

  const handleAdd = async (tmdb_id: number) => {
    setPending((s) => new Set(s).add(tmdb_id));
    try {
      await fetch('/api/manager/movies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tmdb_id }),
      });
      // 해당 영화만 in_db 상태 업데이트
      setMovies((prev) => prev.map((m) => m.tmdb_id === tmdb_id ? { ...m, in_db: true } : m));
    } finally {
      setPending((s) => { const n = new Set(s); n.delete(tmdb_id); return n; });
    }
  };

  const handleDelete = async (tmdb_id: number) => {
    setPending((s) => new Set(s).add(tmdb_id));
    try {
      await fetch(`/api/manager/movies/${tmdb_id}`, { method: 'DELETE' });
      setMovies((prev) => prev.map((m) => m.tmdb_id === tmdb_id ? { ...m, in_db: false } : m));
    } finally {
      setPending((s) => { const n = new Set(s); n.delete(tmdb_id); return n; });
    }
  };

  return (
    <div style={{
      width: '100%', minHeight: '100vh',
      background: 'var(--bg)', color: 'var(--fg)',
      fontFamily: 'var(--font-sans), "Inter Tight", sans-serif',
    }}>
      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '18px 64px',
        background: 'rgba(8,9,13,0.9)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            onClick={() => router.push('/dashboard')}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', padding: 0 }}
          >
            ← 대시보드
          </button>
          <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)' }} />
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>영화 관리</h1>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', color: 'var(--accent)', background: 'color-mix(in oklch, var(--accent) 14%, transparent)', padding: '3px 8px', borderRadius: 4 }}>MANAGER</span>
          <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)' }} />
          <button
            onClick={() => router.push('/movie_list/recent')}
            style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', padding: 0 }}
          >
            최근 추가 데이터
          </button>
        </div>

        {/* 검색바 */}
        <form
          onSubmit={(e) => { e.preventDefault(); runSearch(query); }}
          style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, maxWidth: 420, margin: '0 24px' }}
        >
          <div style={{ position: 'relative', flex: 1 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="영화 이름으로 검색 (TMDB)"
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '8px 30px 8px 12px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8, color: 'var(--fg)',
                fontSize: 12, fontFamily: 'inherit', outline: 'none',
              }}
            />
            {activeQuery && (
              <button
                type="button"
                onClick={() => { setQuery(''); runSearch(''); }}
                title="검색 초기화"
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
                  cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0,
                }}
              >×</button>
            )}
          </div>
          <button
            type="submit"
            style={{
              padding: '8px 14px', border: 'none', borderRadius: 8,
              background: 'color-mix(in oklch, var(--accent) 20%, transparent)',
              color: 'var(--accent)', fontSize: 12, fontWeight: 700,
              fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            검색
          </button>
        </form>

        {/* Pagination */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || loading}
            style={paginationBtn(page === 1 || loading)}
          >
            ← 이전
          </button>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', minWidth: 80, textAlign: 'center' }}>
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages || loading}
            style={paginationBtn(page === totalPages || loading)}
          >
            다음 →
          </button>
          <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
          <button
            onClick={handleLogout}
            title="로그아웃"
            style={{
              padding: '8px 14px',
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 7,
              color: 'rgb(239,120,120)',
              fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
            }}
          >
            로그아웃
          </button>
        </div>
      </header>

      {/* Movie Grid */}
      <main style={{ padding: '32px 64px 60px' }}>
        {loading ? (
          // 스켈레톤
          <div style={gridStyle}>
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} style={{ aspectRatio: '2/3', borderRadius: 8, background: 'rgba(255,255,255,0.05)' }} />
            ))}
          </div>
        ) : movies.length === 0 ? (
          <div style={{ padding: '80px 0', textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
            <div style={{ fontSize: 36, marginBottom: 14 }}>🔍</div>
            <div style={{ fontSize: 14 }}>
              {activeQuery ? `"${activeQuery}" 검색 결과가 없습니다.` : '표시할 영화가 없습니다.'}
            </div>
          </div>
        ) : (
          <div style={gridStyle}>
            {movies.map((m) => {
              const img = posterUrl(m.poster_path);
              const isPending = pending.has(m.tmdb_id);
              const year = m.release_date?.slice(0, 4) ?? '';

              return (
                <div key={m.tmdb_id} style={{
                  display: 'flex', flexDirection: 'column', gap: 8,
                  background: 'rgba(255,255,255,0.02)',
                  border: `1px solid ${m.in_db ? 'rgba(123,97,255,0.25)' : 'rgba(255,255,255,0.06)'}`,
                  borderRadius: 10, overflow: 'hidden',
                }}>
                  {/* 포스터 — 클릭 시 상세/편집 모달 */}
                  <div
                    onClick={() => setDetail({ tmdb_id: m.tmdb_id, title: m.title })}
                    title={m.in_db ? '클릭하여 상세 정보 보기/수정' : 'DB에 추가 후 상세 정보를 수정할 수 있습니다'}
                    style={{ position: 'relative', aspectRatio: '2/3', background: '#111218', flexShrink: 0, cursor: 'pointer' }}
                  >
                    {img ? (
                      <img src={img} alt={m.title} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
                        <span style={{ fontSize: 32 }}>🎬</span>
                      </div>
                    )}
                    {/* DB 상태 badge */}
                    <div style={{
                      position: 'absolute', top: 8, right: 8,
                      fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                      padding: '3px 7px', borderRadius: 4,
                      background: m.in_db ? 'rgba(34,197,94,0.85)' : 'rgba(0,0,0,0.6)',
                      color: m.in_db ? 'black' : 'rgba(255,255,255,0.5)',
                    }}>
                      {m.in_db ? 'DB ✓' : 'DB —'}
                    </div>
                  </div>

                  {/* 메타 + 버튼 */}
                  <div style={{ padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {m.title}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{year}</span>
                      <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', fontFamily: 'var(--font-mono), monospace' }}>#{m.tmdb_id}</span>
                    </div>
                    <button
                      onClick={() => m.in_db ? handleDelete(m.tmdb_id) : handleAdd(m.tmdb_id)}
                      disabled={isPending}
                      style={{
                        marginTop: 2,
                        padding: '7px 0',
                        border: 'none', borderRadius: 6,
                        fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
                        cursor: isPending ? 'not-allowed' : 'pointer',
                        opacity: isPending ? 0.5 : 1,
                        background: m.in_db ? 'rgba(239,68,68,0.15)' : 'color-mix(in oklch, var(--accent) 18%, transparent)',
                        color: m.in_db ? 'rgb(239,100,100)' : 'var(--accent)',
                        transition: 'opacity 0.15s',
                      }}
                    >
                      {isPending ? '처리중...' : m.in_db ? '삭제' : '추가'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* 상세/편집 모달 */}
      {detail && (
        <MovieDetailModal
          tmdbId={detail.tmdb_id}
          fallbackTitle={detail.title}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
  gap: 16,
};

function paginationBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: '8px 14px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 7,
    color: disabled ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.8)',
    fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}
