'use client';

import { useState } from 'react';
import { MOVIES, INITIAL_FILTERS, Movie } from '@/app/lib/data';
import PosterCard from '@/app/components/PosterCard';
import FilterBar from '@/app/components/FilterBar';
import DetailOverlay from '@/app/components/DetailOverlay';
import RandomModal from '@/app/components/RandomModal';

interface Filters {
  yearRange: [number, number];
  genre: string;
  situation: string;
  likes: string[];
  dislikes: string[];
}

export default function Home() {
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [draft, setDraft] = useState<Filters>(INITIAL_FILTERS);
  const [applied, setApplied] = useState<Filters>(INITIAL_FILTERS);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<Movie | null>(null);
  const [randomOpen, setRandomOpen] = useState(false);

  const filtered = MOVIES.filter((m) => {
    if (search && !m.title.toLowerCase().includes(search.toLowerCase()) && !m.titleKo.includes(search)) return false;
    if (applied.genre !== 'All' && !m.genre.includes(applied.genre)) return false;
    if (m.year < applied.yearRange[0] || m.year > applied.yearRange[1]) return false;
    if (applied.dislikes.includes(m.id)) return false;
    return true;
  });

  const repeated = [...filtered, ...filtered].slice(0, 16);

  const togglePref = (id: string, kind: 'like' | 'dislike') => {
    setDraft((d) => {
      const inLikes = d.likes.includes(id);
      const inDislikes = d.dislikes.includes(id);
      if (kind === 'like') {
        return { ...d, likes: inLikes ? d.likes.filter((x) => x !== id) : [...d.likes, id], dislikes: d.dislikes.filter((x) => x !== id) };
      } else {
        return { ...d, dislikes: inDislikes ? d.dislikes.filter((x) => x !== id) : [...d.dislikes, id], likes: d.likes.filter((x) => x !== id) };
      }
    });
  };

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
        position: 'sticky', top: 0, zIndex: 5,
        display: 'flex', alignItems: 'center', gap: 20,
        padding: '20px 64px',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        background: 'rgba(8,9,13,0.85)',
        backdropFilter: 'blur(12px)',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
            placeholder="영화 이름으로 검색…"
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
          Random Pick
        </button>
      </header>

      {/* FILTER BAR */}
      <FilterBar
        open={filterOpen}
        draft={draft}
        onChangeDraft={setDraft}
        onSearch={() => { setApplied(draft); setFilterOpen(false); }}
        onReset={() => setDraft(INITIAL_FILTERS)}
      />

      {/* GRID */}
      <main style={{ flex: 1, position: 'relative', zIndex: 1 }}>
        <div style={{ padding: '28px 64px 60px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 20 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em', margin: 0 }}>오늘의 영화</h2>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
              {filtered.length}편 · 포스터에 마우스를 올려 클라이맥스 그래프를 확인하세요
            </span>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 22,
          }}>
            {repeated.map((m, i) => {
              const key = `${m.id}-${i}`;
              const pref = draft.likes.includes(m.id) ? 'like' as const : draft.dislikes.includes(m.id) ? 'dislike' as const : null;
              return (
                <PosterCard
                  key={key}
                  movie={m}
                  isHovered={hoveredKey === key}
                  onHover={(state) => setHoveredKey(state ? key : null)}
                  onClick={() => setDetail(m)}
                  pref={pref}
                  onTogglePref={togglePref}
                />
              );
            })}
          </div>
        </div>
      </main>

      {/* OVERLAYS */}
      {detail && (
        <DetailOverlay
          movie={detail}
          onClose={() => setDetail(null)}
          onSelectMovie={(m) => setDetail(m)}
        />
      )}
      {randomOpen && (
        <RandomModal
          onClose={() => setRandomOpen(false)}
          onPick={(m) => { setRandomOpen(false); setDetail(m); }}
        />
      )}
    </div>
  );
}
