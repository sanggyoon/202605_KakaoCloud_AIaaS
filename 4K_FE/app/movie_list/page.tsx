'use client';

// 영화 관리 페이지 — TMDB 최신 영화 목록, Supabase DB 존재 여부 확인, 추가/삭제
import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { posterUrl } from '@/app/lib/data';

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

  const fetchMovies = useCallback(async (p: number) => {
    setLoading(true);

    try {
      const res = await fetch(`/api/manager/movies?page=${p}`);
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
    fetchMovies(page);
  }, [page, fetchMovies]);

  const handleAdd = async (tmdb_id: number) => {
    setPending((s) => new Set(s).add(tmdb_id));

    try {
      await fetch('/api/manager/movies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tmdb_id }),
      });

      setMovies((prev) =>
        prev.map((m) =>
          m.tmdb_id === tmdb_id ? { ...m, in_db: true } : m,
        ),
      );
    } finally {
      setPending((s) => {
        const n = new Set(s);
        n.delete(tmdb_id);
        return n;
      });
    }
  };

  const handleDelete = async (tmdb_id: number) => {
    setPending((s) => new Set(s).add(tmdb_id));

    try {
      await fetch(`/api/manager/movies/${tmdb_id}`, {
        method: 'DELETE',
      });

      setMovies((prev) =>
        prev.map((m) =>
          m.tmdb_id === tmdb_id ? { ...m, in_db: false } : m,
        ),
      );
    } finally {
      setPending((s) => {
        const n = new Set(s);
        n.delete(tmdb_id);
        return n;
      });
    }
  };

  return (
    <div
      className="min-h-screen w-full bg-[var(--bg)] text-[var(--fg)]"
      style={{
        fontFamily: 'var(--font-sans), "Inter Tight", sans-serif',
      }}
    >
      {/* Header */}
      <header
        className="
          sticky top-0 z-10
          flex flex-col gap-3
          border-b border-white/[0.06]
          bg-[rgba(8,9,13,0.9)]
          px-4 py-3
          backdrop-blur-xl
          sm:px-8
          md:flex-row md:items-center md:justify-between
          lg:px-16
        "
      >
        <div className="flex flex-wrap items-center gap-3 md:gap-4">
          <button
            onClick={() => router.push('/dashboard')}
            className="
              cursor-pointer border-none bg-transparent p-0
              text-[13px] text-white/50
              transition-colors hover:text-white/80
            "
          >
            ← 대시보드
          </button>

          <div className="hidden h-4 w-px bg-white/10 sm:block" />

          <h1 className="m-0 text-lg font-bold tracking-[-0.02em]">
            영화 관리
          </h1>

          <span
            className="
              rounded px-2 py-[3px]
              text-[10px] font-bold tracking-[0.15em]
              text-[var(--accent)]
            "
            style={{
              background:
                'color-mix(in oklch, var(--accent) 14%, transparent)',
            }}
          >
            MANAGER
          </span>
        </div>

        {/* Pagination */}
        <div className="flex w-full items-center gap-2 sm:w-auto sm:gap-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || loading}
            style={paginationBtn(page === 1 || loading)}
            className="flex-1 sm:flex-none"
          >
            ← 이전
          </button>

          <span className="min-w-16 text-center text-xs text-white/50 sm:min-w-20">
            {page} / {totalPages}
          </span>

          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages || loading}
            style={paginationBtn(page === totalPages || loading)}
            className="flex-1 sm:flex-none"
          >
            다음 →
          </button>
        </div>
      </header>

      {/* Movie Grid */}
      <main className="px-4 py-8 pb-16 sm:px-8 lg:px-16">
        {loading ? (
          <div className="movie-grid">
            {Array.from({ length: 20 }).map((_, i) => (
              <div
                key={i}
                className="aspect-[2/3] rounded-lg bg-white/[0.05]"
              />
            ))}
          </div>
        ) : (
          <div className="movie-grid">
            {movies.map((m) => {
              const img = posterUrl(m.poster_path);
              const isPending = pending.has(m.tmdb_id);
              const year = m.release_date?.slice(0, 4) ?? '';

              return (
                <div
                  key={m.tmdb_id}
                  className="
                    flex flex-col gap-2 overflow-hidden rounded-[10px]
                    bg-white/[0.02]
                  "
                  style={{
                    border: `1px solid ${
                      m.in_db
                        ? 'rgba(123,97,255,0.25)'
                        : 'rgba(255,255,255,0.06)'
                    }`,
                  }}
                >
                  {/* 포스터 */}
                  <div className="relative aspect-[2/3] shrink-0 bg-[#111218]">
                    {img ? (
                      <img
                        src={img}
                        alt={m.title}
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 grid place-items-center">
                        <span className="text-3xl">🎬</span>
                      </div>
                    )}

                    {/* DB 상태 badge */}
                    <div
                      className="
                        absolute right-2 top-2 rounded px-[7px] py-[3px]
                        text-[9px] font-bold tracking-[0.1em]
                      "
                      style={{
                        background: m.in_db
                          ? 'rgba(34,197,94,0.85)'
                          : 'rgba(0,0,0,0.6)',
                        color: m.in_db ? 'black' : 'rgba(255,255,255,0.5)',
                      }}
                    >
                      {m.in_db ? 'DB ✓' : 'DB —'}
                    </div>
                  </div>

                  {/* 메타 + 버튼 */}
                  <div className="flex flex-col gap-1.5 px-2.5 pb-2.5">
                    <div
                      className="
                        line-clamp-2 text-xs font-bold leading-[1.3]
                      "
                    >
                      {m.title}
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-white/40">
                        {year}
                      </span>

                      <span
                        className="
                          truncate text-[9px] text-white/25
                        "
                        style={{
                          fontFamily: 'var(--font-mono), monospace',
                        }}
                      >
                        #{m.tmdb_id}
                      </span>
                    </div>

                    <button
                      onClick={() =>
                        m.in_db
                          ? handleDelete(m.tmdb_id)
                          : handleAdd(m.tmdb_id)
                      }
                      disabled={isPending}
                      className="
                        mt-0.5 rounded-md border-none py-[7px]
                        text-[11px] font-bold
                        transition-opacity
                      "
                      style={{
                        cursor: isPending ? 'not-allowed' : 'pointer',
                        opacity: isPending ? 0.5 : 1,
                        background: m.in_db
                          ? 'rgba(239,68,68,0.15)'
                          : 'color-mix(in oklch, var(--accent) 18%, transparent)',
                        color: m.in_db
                          ? 'rgb(239,100,100)'
                          : 'var(--accent)',
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
    </div>
  );
}

function paginationBtn(disabled: boolean): CSSProperties {
  return {
    padding: '8px 14px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 7,
    color: disabled ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontWeight: 600,
    fontFamily: 'inherit',
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}