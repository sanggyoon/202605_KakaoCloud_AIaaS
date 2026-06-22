'use client';

// 메인 대시보드 — 영화 목록, 검색/필터, 선호 설정, 최근 기록, 랜덤 추천을 통합 관리
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  INITIAL_FILTERS,
  Filters,
  Movie,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  getRecentIds,
  addRecentId,
  removeRecentId,
  fetchPreferredMovies,
  logVisit,
} from '@/app/lib/data';
import Image from 'next/image';
import PosterCard from '@/app/components/PosterCard';
import FilterBar from '@/app/components/FilterBar';
import DetailOverlay from '@/app/components/DetailOverlay';
import RandomModal from '@/app/components/RandomModal';
import Tutorial from '@/app/components/Tutorial';
import BackgroundThread from '@/app/components/BackgroundThread';

// 한 번에 가져올 영화 수 — 서버사이드 필터링으로 Supabase가 조건 적용 후 이 단위로 반환
const PAGE_SIZE = 120;
// 목록 카드에 필요한 컬럼만 — overview/actors 등 무거운 필드 제외(상세에서 지연 로드)
const LIST_SELECT = 'id,tmdb_id,title,original_title,poster_path,release_year,genre,has_vector';

// 안정적인 참조 — 인라인 배열이면 리렌더(카드 호버 등)마다 새 참조가 되어
// BackgroundThread의 useEffect가 재실행→캔버스 재생성→흰 깜빡임이 발생한다.
const THREAD_COLOR: [number, number, number] = [0.482, 0.38, 1];

export default function Dashboard() {
  const router = useRouter();

  useEffect(() => {
    logVisit();
  }, []);

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
    typeof window === 'undefined' ? [] : getRecentIds(),
  );
  // 히스토리 영화 데이터 캐시 — 메인 목록(movies)과 독립적으로 id 기준 조회해
  // 정렬/검색/필터로 movies가 바뀌어도 최근 본 영화가 사라지지 않게 한다.
  const [recentCache, setRecentCache] = useState<Map<number, Movie>>(new Map());
  useEffect(() => {
    const missing = recentIds.filter((id) => !recentCache.has(id));
    if (missing.length === 0) return;
    const url = `${SUPABASE_URL}/rest/v1/movies?select=${LIST_SELECT}&tmdb_id=in.(${missing.join(',')})`;
    fetch(url, { headers: { apikey: SUPABASE_ANON_KEY } })
      .then((r) => r.json())
      .then((data: Movie[]) => {
        const arr = Array.isArray(data) ? data : [];
        if (arr.length === 0) return;
        setRecentCache((prev) => {
          const next = new Map(prev);
          for (const m of arr) next.set(m.tmdb_id, m);
          return next;
        });
      })
      .catch(() => {});
  }, [recentIds, recentCache]);
  const [search, setSearch] = useState('');
  // 검색어를 fetch 콜백/페이지네이션에서 항상 최신값으로 참조하기 위한 ref
  const searchRef = useRef('');
  useEffect(() => {
    searchRef.current = search;
  }, [search]);
  // 연도 정렬 방향 — false=최신순(기본), true=오래된 순. fetchMovies가 useCallback([])이라 ref로 최신값 참조
  const [sortAsc, setSortAsc] = useState(false);
  const sortAscRef = useRef(false);
  useEffect(() => {
    sortAscRef.current = sortAsc;
  }, [sortAsc]);
  const [filterOpen, setFilterOpen] = useState(false);
  // draft: 편집 중인 필터 상태 / applied: 실제 목록에 적용된 필터 상태
  const [draft, setDraft] = useState<Filters>(INITIAL_FILTERS);
  const [applied, setApplied] = useState<Filters>(INITIAL_FILTERS);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  // 선호/비선호 영화 제목 조회용 캐시 — 검색 후 movies 목록이 교체돼도 타이틀 표시 유지
  const [prefMovieCache, setPrefMovieCache] = useState<Map<number, Movie>>(new Map());
  const [detail, setDetail] = useState<Movie | null>(null);
  const [randomOpen, setRandomOpen] = useState(false);
  // localStorage에서 lazy 초기화 — 완료 기록이 있으면 null(튜토리얼 숨김)
  const [tutorialStep, setTutorialStep] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('peakly_tutorial_done') === '1' ? null : 0;
  });

  // Supabase REST API에서 서버사이드 필터 조건을 포함해 PAGE_SIZE 단위로 fetch
  const fetchMovies = useCallback((offset: number, filters: Filters) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    if (offset > 0) setLoadingMore(true);

    // 연도·장르·비선호 조건을 쿼리 파라미터로 서버에 전달
    // 그래프 보유 영화(has_vector)는 항상 맨 앞 유지, 연도+id 방향만 토글
    const dir = sortAscRef.current ? 'asc' : 'desc';
    let url = `/api/movies?select=${LIST_SELECT}&limit=${PAGE_SIZE}&offset=${offset}&order=has_vector.desc,release_year.${dir},id.${dir}`;
    url += `&release_year=gte.${filters.yearRange[0]}&release_year=lte.${filters.yearRange[1]}`;
    if (filters.genre !== 'All') {
      url += `&genre=ilike.*${encodeURIComponent(filters.genre)}*`;
    }
    if (filters.dislikes.length > 0) {
      url += `&tmdb_id=not.in.(${filters.dislikes.join(',')})`;
    }
    for (const g of filters.dislikeGenres) {
      url += `&genre=not.ilike.*${encodeURIComponent(g)}*`;
    }
    // 제목 검색은 svc db 전체를 대상으로 서버에서 OR ilike — 로드된 목록이 아니라
    // DB 전체에서 찾고, has_vector 우선 정렬이 검색 결과에도 그대로 적용된다.
    const q = searchRef.current.trim();
    if (q) {
      const enc = encodeURIComponent(q);
      url += `&or=(title.ilike.*${enc}*,original_title.ilike.*${enc}*)`;
    }

    fetch(url)
      .then((r) => r.json())
      .then((data: Movie[]) => {
        const arr = Array.isArray(data) ? data : [];
        // offset=0이면 새 목록으로 교체, 이후엔 누적
        setMovies((prev) => (offset === 0 ? arr : [...prev, ...arr]));
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

  // applied 필터가 바뀌면 항상 처음부터 다시 fetch
  // likes 있으면 벡터 RPC, 없으면 일반 최신순 목록
  const appliedRef = useRef<Filters>(INITIAL_FILTERS);
  useEffect(() => {
    appliedRef.current = applied;
    isFetchingRef.current = false;
    setMovies([]);
    offsetRef.current = 0;
    setLoading(true);

    if (applied.likes.length > 0 || applied.dislikes.length > 0) {
      setHasMore(false);
      fetchPreferredMovies(applied.likes, applied.dislikes).then((data) => {
        setMovies(data);
        setLoading(false);
      });
    } else {
      setHasMore(true);
      fetchMovies(0, applied);
    }
  }, [applied, fetchMovies]);

  // 검색어 변경 → svc db 전체 재조회(디바운스 300ms). 첫 마운트는 위 applied effect가
  // 이미 초기 로드하므로 건너뛴다. 벡터 모드(선호/비선호)는 RPC 결과를 클라이언트에서 검색.
  const searchMountRef = useRef(true);
  useEffect(() => {
    if (searchMountRef.current) {
      searchMountRef.current = false;
      return;
    }
    if (appliedRef.current.likes.length > 0 || appliedRef.current.dislikes.length > 0) return;
    const t = setTimeout(() => {
      isFetchingRef.current = false;
      setMovies([]);
      offsetRef.current = 0;
      setHasMore(true);
      setLoading(true);
      fetchMovies(0, appliedRef.current);
    }, 300);
    return () => clearTimeout(t);
  }, [search, fetchMovies]);

  // 정렬 방향 변경 → offset=0부터 재조회(무한스크롤 누적 초기화). 첫 마운트는 applied effect가
  // 이미 초기 로드하므로 건너뛴다. 벡터 모드(선호/비선호)는 유사도순 RPC 결과라 정렬 무시.
  const sortMountRef = useRef(true);
  useEffect(() => {
    if (sortMountRef.current) {
      sortMountRef.current = false;
      return;
    }
    if (appliedRef.current.likes.length > 0 || appliedRef.current.dislikes.length > 0) return;
    isFetchingRef.current = false;
    setMovies([]);
    offsetRef.current = 0;
    setHasMore(true);
    setLoading(true);
    fetchMovies(0, appliedRef.current);
  }, [sortAsc, fetchMovies]);

  // sentinel 요소가 뷰포트에 진입하면 다음 페이지 fetch — appliedRef로 현재 필터 참조
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isFetchingRef.current) {
          fetchMovies(offsetRef.current, appliedRef.current);
        }
      },
      { rootMargin: '300px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, fetchMovies]);

  const closeTutorial = () => {
    setTutorialStep(null);
    localStorage.setItem('peakly_tutorial_done', '1');
  };

  const handleOpenDetail = (m: Movie) => {
    addRecentId(m.tmdb_id);
    setRecentIds(getRecentIds());
    setDetail(m);
  };

  const handleDeleteRecent = (tmdbId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    removeRecentId(tmdbId);
    setRecentIds(getRecentIds());
  };

  // 선호/비선호는 상호 배타적 — 같은 영화에 중복 선택 불가
  const togglePref = (id: number, kind: 'like' | 'dislike') => {
    const found = movies.find((m) => m.tmdb_id === id);
    if (found) setPrefMovieCache((prev) => new Map(prev).set(id, found));
    setDraft((d) => {
      if (kind === 'like') {
        const inLikes = d.likes.includes(id);
        return {
          ...d,
          likes: inLikes ? d.likes.filter((x) => x !== id) : [...d.likes, id],
          dislikes: d.dislikes.filter((x) => x !== id),
        };
      } else {
        const inDislikes = d.dislikes.includes(id);
        return {
          ...d,
          dislikes: inDislikes
            ? d.dislikes.filter((x) => x !== id)
            : [...d.dislikes, id],
          likes: d.likes.filter((x) => x !== id),
        };
      }
    });
  };

  // 벡터 모드: RPC 결과를 클라이언트에서 연도·장르 필터링
  // 일반 모드: 서버가 이미 필터링 — 클라이언트는 제목 검색만
  const isVectorMode = applied.likes.length > 0 || applied.dislikes.length > 0;
  const filtered = movies.filter((m) => {
    if (isVectorMode) {
      const yr = m.release_year ?? 0;
      if (yr < applied.yearRange[0] || yr > applied.yearRange[1]) return false;
      if (applied.genre !== 'All' && !m.genre?.toLowerCase().includes(applied.genre.toLowerCase())) return false;
      if (applied.dislikeGenres.some((g) => m.genre?.toLowerCase().includes(g.toLowerCase()))) return false;
    }
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      m.title.toLowerCase().includes(q) ||
      Boolean(m.original_title?.toLowerCase().includes(q))
    );
  });

  // recentIds 순서(최신순)를 유지하면서 독립 캐시에서 매핑 — 메인 목록과 무관
  const recentMovies = recentIds
    .map((id) => recentCache.get(id))
    .filter((m): m is Movie => Boolean(m))
    .slice(0, 10);

  // 스크롤 300px 이상이면 맨 위로 버튼 표시
  const [showTopBtn, setShowTopBtn] = useState(false);
  useEffect(() => {
    const onScroll = () => setShowTopBtn(window.scrollY > 300);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      style={{
        width: '100%',
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--fg)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'var(--font-sans), "Inter Tight", sans-serif',
        position: 'relative',
      }}
    >
      {/* 고정 배경 — 온보딩과 동일한 움직이는 실 애니메이션(스크롤해도 고정).
          불투명 다크 배경을 깔아 빠른 스크롤 중 캔버스가 빈 흰 프레임을 보여도 흰색이 노출되지 않게 함.
          translateZ로 GPU 레이어 승격. */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        background: 'var(--bg)',
        transform: 'translateZ(0)', backfaceVisibility: 'hidden', willChange: 'transform',
      }}>
        <div style={{ position: 'absolute', inset: 0, opacity: 0.68 }}>
          <BackgroundThread
            color={THREAD_COLOR}
            amplitude={1.1}
            distance={0.4}
            enableMouseInteraction={false}
          />
        </div>
      </div>

      {/* ambient spotlight */}
      <div
        style={{
          position: 'fixed',
          top: -100,
          left: '20%',
          width: '70%',
          height: 400,
          background:
            'radial-gradient(ellipse at top, color-mix(in oklch, var(--accent) 10%, transparent) 0%, transparent 65%)',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      {/* HEADER + FILTER — sticky 래퍼로 묶어 필터바가 콘텐츠 위에 오버레이 */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 5,
          transition: 'z-index 0s',
        }}
      >
        <header
          className="dash-header"
          style={{
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            background: 'rgba(8,9,13,0.85)',
            backdropFilter: 'blur(12px)',
          }}
        >
          {/* Left: 로고 */}
          <div className="dash-left">
            <div
              onClick={() => router.push('/')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
              }}
            >
              <img
                src="/peakly-black-bg.svg"
                alt="Peakly"
                width={30}
                height={30}
                style={{
                  display: 'block',
                  borderRadius: 7,
                  filter:
                    'drop-shadow(0 0 10px color-mix(in oklch, var(--accent) 40%, transparent))',
                }}
              />
              <div
                style={{
                  fontWeight: 900,
                  fontSize: 17,
                  letterSpacing: '-0.04em',
                }}
              >
                Peakly
              </div>
            </div>
          </div>

          {/* Center: 검색바 */}
          <div className="dash-search">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="rgba(255,255,255,0.5)"
              strokeWidth="2"
              style={{
                position: 'absolute',
                left: 14,
                top: '50%',
                transform: 'translateY(-50%)',
              }}
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="영화 제목 검색..."
              style={{
                width: '100%',
                padding: '11px 14px 11px 38px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 9,
                color: 'var(--fg)',
                fontSize: 13,
                fontFamily: 'inherit',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Right: 필터 + 랜덤 추천 */}
          <div className="dash-right">
            <button
              onClick={() => setFilterOpen((v) => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 14px',
                background: filterOpen
                  ? 'color-mix(in oklch, var(--accent) 14%, transparent)'
                  : 'rgba(255,255,255,0.04)',
                border: `1px solid ${filterOpen ? 'color-mix(in oklch, var(--accent) 38%, transparent)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 9,
                color: filterOpen ? 'var(--accent)' : 'rgba(255,255,255,0.85)',
                fontSize: 12,
                fontWeight: 600,
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
              >
                <path d="M3 6h18M7 12h10M11 18h2" strokeLinecap="round" />
              </svg>
              <span className="btn-label">필터</span>
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                style={{
                  transform: filterOpen ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.25s',
                }}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <button
              onClick={() => setRandomOpen(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 16px',
                background: 'var(--accent)',
                border: 'none',
                borderRadius: 9,
                color: 'black',
                fontSize: 12,
                fontWeight: 700,
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path
                  d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="btn-label">랜덤 추천</span>
            </button>
            <button
              onClick={() => setTutorialStep(0)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '10px 14px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 9,
                color: 'rgba(255,255,255,0.75)',
                fontSize: 12,
                fontWeight: 600,
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </header>

        {/* 필터바 — absolute 오버레이, 콘텐츠를 밀어내지 않음 */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: '100%' }}>
          <FilterBar
            open={filterOpen}
            draft={draft}
            movies={Array.from(prefMovieCache.values())}
            onChangeDraft={setDraft}
            onSearch={() => { setApplied(draft); setFilterOpen(false); }}
            onReset={() => { setDraft(INITIAL_FILTERS); setPrefMovieCache(new Map()); }}
            search={search}
            onSearchChange={setSearch}
          />
        </div>
      </div>

      {/* MAIN */}
      <main style={{ flex: 1, position: 'relative', zIndex: 1 }}>
        <div className="px-page" style={{ paddingTop: 28, paddingBottom: 60 }}>
          {/* 최근 살펴본 영화 — 가로 스크롤, 스크롤바 숨김 */}
          {recentMovies.length > 0 && (
            <div style={{ marginBottom: 44 }}>
              <h2
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  margin: '0 0 20px',
                }}
              >
                최근 살펴본 영화
              </h2>
              <div
                className="no-scrollbar"
                style={{ display: 'flex', gap: 18, overflowX: 'auto' }}
              >
                {recentMovies.map((m, i) => {
                  const key = `recent-${m.tmdb_id}-${i}`;
                  const pref = draft.likes.includes(m.tmdb_id)
                    ? ('like' as const)
                    : draft.dislikes.includes(m.tmdb_id)
                      ? ('dislike' as const)
                      : null;
                  return (
                    <div key={key} className="recent-card-wrap" style={{ flex: '0 0 180px', minWidth: 0, position: 'relative' }}>
                      <PosterCard
                        movie={m}
                        isHovered={hoveredKey === key}
                        onHover={(state) => setHoveredKey(state ? key : null)}
                        onClick={() => handleOpenDetail(m)}
                        pref={pref}
                        onTogglePref={togglePref}
                      />
                      <button
                        onClick={(e) => handleDeleteRecent(m.tmdb_id, e)}
                        style={{
                          position: 'absolute', top: 6, right: 6,
                          width: 22, height: 22, borderRadius: 999,
                          background: 'rgba(0,0,0,0.65)',
                          border: '1px solid rgba(255,255,255,0.18)',
                          color: 'rgba(255,255,255,0.85)',
                          cursor: 'pointer', display: 'grid', placeItems: 'center',
                          zIndex: 10, padding: 0,
                          opacity: 1,
                        }}
                      >
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 20,
            }}
          >
            <h2
              style={{
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: '-0.02em',
                margin: 0,
              }}
            >
              {loading ? '불러오는 중...' : '영화 목록'}
            </h2>
            {/* 정렬 토글 — 벡터(선호/비선호) 모드에서는 유사도순이라 숨김 */}
            {!isVectorMode && (
              <div
                style={{
                  display: 'flex',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 8,
                  overflow: 'hidden',
                }}
              >
                {([
                  { label: '최신순', asc: false },
                  { label: '오래된 순', asc: true },
                ] as const).map((opt) => {
                  const active = sortAsc === opt.asc;
                  return (
                    <button
                      key={opt.label}
                      onClick={() => setSortAsc(opt.asc)}
                      disabled={loading}
                      style={{
                        background: active ? 'color-mix(in oklch, var(--accent) 22%, transparent)' : 'none',
                        border: 'none',
                        color: active ? 'var(--accent)' : 'rgba(255,255,255,0.55)',
                        fontSize: 12,
                        fontWeight: 600,
                        fontFamily: 'inherit',
                        padding: '5px 12px',
                        cursor: loading ? 'not-allowed' : 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 스켈레톤 UI — 초기 로딩 중 레이아웃 자리 유지 */}
          {loading ? (
            <div className="movie-grid">
              {Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    aspectRatio: '2 / 3',
                    borderRadius: 8,
                    background: 'rgba(255,255,255,0.05)',
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="movie-grid">
              {filtered.map((m, i) => {
                const key = `${m.tmdb_id}-${i}`;
                const pref = draft.likes.includes(m.tmdb_id)
                  ? ('like' as const)
                  : draft.dislikes.includes(m.tmdb_id)
                    ? ('dislike' as const)
                    : null;
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
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                padding: '32px 0',
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  color: 'rgba(255,255,255,0.4)',
                  letterSpacing: '0.1em',
                }}
              >
                불러오는 중...
              </span>
            </div>
          )}
        </div>
      </main>

      {/* OVERLAYS */}
      {detail && (
        <DetailOverlay
          movie={detail}
          onClose={() => setDetail(null)}
          onSelectMovie={(m) => {
            setDetail(m);
            handleOpenDetail(m);
          }}
        />
      )}
      {randomOpen && (
        <RandomModal
          movies={movies}
          onClose={() => setRandomOpen(false)}
          onPick={(m) => {
            setRandomOpen(false);
            handleOpenDetail(m);
          }}
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

      {/* 맨 위로 버튼 — 항상 DOM에 두고 opacity+translateY로 슬라이드 인/아웃.
          모바일에선 필터바가 열려 화면을 덮는 동안 숨김(globals.css). */}
      <button
        className={filterOpen ? 'move-top-btn move-top-btn--filter-open' : 'move-top-btn'}
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        style={{
          position: 'fixed',
          bottom: 32,
          left: '50%',
          transform: showTopBtn ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(20px)',
          opacity: showTopBtn ? 1 : 0,
          pointerEvents: showTopBtn ? 'auto' : 'none',
          transition: 'opacity 0.25s, transform 0.25s',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          zIndex: 20,
          padding: 0,
        }}
      >
        <Image src="/move-top-btn.svg" alt="맨 위로" width={112} height={44} />
      </button>
    </div>
  );
}
