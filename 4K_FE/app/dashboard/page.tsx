'use client';

// 메인 대시보드 — 영화 목록, 검색/필터, 선호 설정, 최근 기록, 랜덤 추천을 통합 관리
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { INITIAL_FILTERS, Filters, Movie, SUPABASE_URL, SUPABASE_ANON_KEY, getRecentIds, addRecentId } from '@/app/lib/data';
import PosterCard from '@/app/components/PosterCard';
import FilterBar from '@/app/components/FilterBar';
import DetailOverlay from '@/app/components/DetailOverlay';
import RandomModal from '@/app/components/RandomModal';
import Tutorial from '@/app/components/Tutorial';

// 한 번에 가져오는 영화 수 — 너무 크면 초기 로딩이 느려짐
const PAGE_SIZE = 120;

export default function Dashboard() {
  const router = useRouter();
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  // ref 사용 이유: 렌더 사이클 밖에서 fetch 중복 방지 및 누적 offset 추적
  const offsetRef = useRef(0);
  const isFetchingRef = useRef(false);
  // IntersectionObserver 감지 대상 — 목록 최하단에 위치
  const sentinelRef = useRef<HTMLDivElement>(null);
  // localStorage에서 lazy 초기화 — SSR 환경(window 없음) 방어
  const [recentIds, setRecentIds] = useState<number[]>(() =>
    typeof window === 'undefined' ? [] : getRecentIds()
  );
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  // draft: 편집 중인 필터 상태 / applied: 실제 목록에 적용된 필터 상태
  const [draft, setDraft] = useState<Filters>(INITIAL_FILTERS);
  const [applied, setApplied] = useState<Filters>(INITIAL_FILTERS);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<Movie | null>(null);
  const [randomOpen, setRandomOpen] = useState(false);
  // localStorage에서 lazy 초기화 — 완료 기록이 있으면 null(튜토리얼 숨김)
  const [tutorialStep, setTutorialStep] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('4k_tutorial_done') ? null : 0;
  });

  // Supabase REST API에서 PAGE_SIZE 단위로 영화를 페이지네이션 fetch
  const fetchMovies = useCallback((offset: number) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    if (offset > 0) setLoadingMore(true);

    fetch(`${SUPABASE_URL}/rest/v1/movies?select=*&limit=${PAGE_SIZE}&offset=${offset}&order=id.asc`, {
      headers: { apikey: SUPABASE_ANON_KEY },
    })
      .then((r) => r.json())
      .then((data: Movie[]) => {
        const arr = Array.isArray(data) ? data : [];
        // offset=0이면 새 목록으로 교체, 이후엔 누적
        setMovies((prev) => offset === 0 ? arr : [...prev, ...arr]);
        offsetRef.current = offset + arr.length;
        // 반환된 수가 PAGE_SIZE보다 적으면 마지막 페이지
        setHasMore(arr.length === PAGE_SIZE);
      })
      .catch(() => {})
      .finally(() => {
        isFetchingRef.current = false;
        if (offset === 0) setLoading(false);
        else setLoadingMore(false);
      });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchMovies(0);
  }, [fetchMovies]);

  // sentinel 요소가 뷰포트에 진입하면 다음 페이지 fetch — rootMargin으로 300px 앞당겨 미리 로드
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isFetchingRef.current) {
          fetchMovies(offsetRef.current);
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, fetchMovies]);

  const closeTutorial = () => {
    setTutorialStep(null);
    localStorage.setItem('4k_tutorial_done', '1');
  };

  const handleOpenDetail = (m: Movie) => {
    addRecentId(m.tmdb_id);
    setRecentIds(getRecentIds());
    setDetail(m);
  };

  // 선호/비선호는 상호 배타적 — 같은 영화에 중복 선택 불가
  const togglePref = (id: number, kind: 'like' | 'dislike') => {
    setDraft((d) => {
      if (kind === 'like') {
        const inLikes = d.likes.includes(id);
        return { ...d, likes: inLikes ? d.likes.filter((x) => x !== id) : [...d.likes, id], dislikes: d.dislikes.filter((x) => x !== id) };
      } else {
        const inDislikes = d.dislikes.includes(id);
        return { ...d, dislikes: inDislikes ? d.dislikes.filter((x) => x !== id) : [...d.dislikes, id], likes: d.likes.filter((x) => x !== id) };
      }
    });
  };

  // 검색과 applied 필터를 클라이언트 사이드에서 조합 — 비선호 영화는 목록에서 완전히 제거
  const filtered = movies.filter((m) => {
    if (search) {
      const q = search.toLowerCase();
      if (!m.title.toLowerCase().includes(q) && !(m.original_title?.toLowerCase().includes(q))) return false;
    }
    if (applied.genre !== 'All' && !m.genre?.includes(applied.genre)) return false;
    const year = m.release_year ?? 0;
    if (year < applied.yearRange[0] || year > applied.yearRange[1]) return false;
    if (applied.dislikes.includes(m.tmdb_id)) return false;
    return true;
  });

  // recentIds 순서(최신순)를 유지하면서 로드된 movies에서 매핑
  const recentMovies = recentIds
    .map((id) => movies.find((m) => m.tmdb_id === id))
    .filter((m): m is Movie => Boolean(m))
    .slice(0, 10);

  // 튜토리얼 step 1~2에서는 헤더를 backdrop보다 위에 노출해 강조
  const isHeaderHighlighted = tutorialStep === 1 || tutorialStep === 2;
  const headerZIndex = isHeaderHighlighted ? 50 : 5;

  return (
    <div style={{
      width: '100%', minHeight: '100vh',
      background: 'var(--bg)', color: 'var(--fg)',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'var(--font-sans), "Inter Tight", sans-serif',
      position: 'relative',
    }}>
      {/* ambient spotlight */}
      <div style={{
        position: 'fixed', top: -100, left: '20%', width: '70%', height: 400,
        background: 'radial-gradient(ellipse at top, color-mix(in oklch, var(--accent) 10%, transparent) 0%, transparent 65%)',
        pointerEvents: 'none', zIndex: 0,
      }} />

      {/* HEADER */}
      <header style={{
        position: 'sticky', top: 0, zIndex: headerZIndex,
        display: 'flex', alignItems: 'center', gap: 20,
        padding: '20px 64px',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        background: 'rgba(8,9,13,0.85)',
        backdropFilter: 'blur(12px)',
        transition: 'z-index 0s',
      }}>
        {/* Logo */}
        <div
          onClick={() => router.push('/')}
          style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
        >
          <div style={{
            width: 30, height: 30, borderRadius: 7,
            background: 'linear-gradient(135deg, var(--accent), color-mix(in oklch, var(--accent) 55%, black))',
            display: 'grid', placeItems: 'center',
            boxShadow: '0 0 20px color-mix(in oklch, var(--accent) 35%, transparent)',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5">
              <path d="M3 18 L8 14 L12 16 L16 8 L21 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: '-0.02em' }}>4K Cinema</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.18em', fontWeight: 600 }}>CLIMAX-BASED RECOMMENDATION</div>
          </div>
        </div>

        {/* Search */}
        <div style={{ flex: 1, maxWidth: 560, position: 'relative', marginLeft: 20 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }}>
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="영화 제목 검색..."
            style={{
              width: '100%', padding: '11px 14px 11px 38px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 9,
              color: 'var(--fg)', fontSize: 13,
              fontFamily: 'inherit', outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Filter button */}
        <button
          onClick={() => setFilterOpen((v) => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 14px',
            background: filterOpen ? 'color-mix(in oklch, var(--accent) 14%, transparent)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${filterOpen ? 'color-mix(in oklch, var(--accent) 38%, transparent)' : 'rgba(255,255,255,0.08)'}`,
            borderRadius: 9,
            color: filterOpen ? 'var(--accent)' : 'rgba(255,255,255,0.85)',
            fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M3 6h18M7 12h10M11 18h2" strokeLinecap="round" />
          </svg>
          필터
          <svg
            width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            style={{ transform: filterOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.25s' }}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {/* Random Pick */}
        <button
          onClick={() => setRandomOpen(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 16px',
            background: 'var(--accent)',
            border: 'none', borderRadius: 9,
            color: 'black',
            fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          랜덤 추천
        </button>

        {/* Tutorial */}
        <button
          onClick={() => setTutorialStep(0)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 14px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 9,
            color: 'rgba(255,255,255,0.75)',
            fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
          </svg>
          튜토리얼
        </button>
      </header>

      {/* FILTER BAR — 헤더 바로 아래 sticky, 검색 버튼 누를 때만 applied에 반영 */}
      <FilterBar
        open={filterOpen}
        draft={draft}
        movies={movies}
        onChangeDraft={setDraft}
        onSearch={() => { setApplied(draft); setFilterOpen(false); }}
        onReset={() => setDraft(INITIAL_FILTERS)}
      />

      {/* MAIN */}
      <main style={{ flex: 1, position: 'relative', zIndex: 1 }}>
        <div style={{ padding: '28px 64px 60px' }}>

          {/* 최근 살펴본 영화 — 가로 스크롤, 스크롤바 숨김 */}
          {recentMovies.length > 0 && (
            <div style={{ marginBottom: 44 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 20px' }}>최근 살펴본 영화</h2>
              <div
                className="no-scrollbar"
                style={{ display: 'flex', gap: 18, overflowX: 'auto' }}
              >
                {recentMovies.map((m, i) => {
                  const key = `recent-${m.tmdb_id}-${i}`;
                  const pref = draft.likes.includes(m.tmdb_id) ? 'like' as const : draft.dislikes.includes(m.tmdb_id) ? 'dislike' as const : null;
                  return (
                    <div key={key} style={{ flex: '0 0 180px' }}>
                      <PosterCard
                        movie={m}
                        isHovered={hoveredKey === key}
                        onHover={(state) => setHoveredKey(state ? key : null)}
                        onClick={() => handleOpenDetail(m)}
                        pref={pref}
                        onTogglePref={togglePref}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 20 }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
              {loading ? '불러오는 중...' : '영화 목록'}
            </h2>
            {!loading && (
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>{filtered.length}편</span>
            )}
          </div>

          {/* 스켈레톤 UI — 초기 로딩 중 레이아웃 자리 유지 */}
          {loading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 22 }}>
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} style={{ aspectRatio: '2 / 3', borderRadius: 8, background: 'rgba(255,255,255,0.05)' }} />
              ))}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 22 }}>
              {filtered.map((m, i) => {
                const key = `${m.tmdb_id}-${i}`;
                const pref = draft.likes.includes(m.tmdb_id) ? 'like' as const : draft.dislikes.includes(m.tmdb_id) ? 'dislike' as const : null;
                return (
                  <PosterCard
                    key={key}
                    movie={m}
                    isHovered={hoveredKey === key}
                    onHover={(state) => setHoveredKey(state ? key : null)}
                    onClick={() => handleOpenDetail(m)}
                    pref={pref}
                    onTogglePref={togglePref}
                  />
                );
              })}
            </div>
          )}

          {/* sentinel — 뷰포트 진입 시 다음 페이지 fetch 트리거 */}
          <div ref={sentinelRef} style={{ height: 1 }} />
          {loadingMore && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em' }}>불러오는 중...</span>
            </div>
          )}
        </div>
      </main>

      {/* OVERLAYS */}
      {detail && (
        <DetailOverlay
          movie={detail}
          movies={movies}
          onClose={() => setDetail(null)}
          onSelectMovie={(m) => { setDetail(m); handleOpenDetail(m); }}
        />
      )}
      {randomOpen && (
        <RandomModal
          movies={movies}
          onClose={() => setRandomOpen(false)}
          onPick={(m) => { setRandomOpen(false); handleOpenDetail(m); }}
        />
      )}

      {/* TUTORIAL */}
      {tutorialStep !== null && (
        <Tutorial
          step={tutorialStep}
          onNext={() => setTutorialStep((s) => (s !== null ? s + 1 : null))}
          onSkip={closeTutorial}
          onComplete={closeTutorial}
        />
      )}
    </div>
  );
}
