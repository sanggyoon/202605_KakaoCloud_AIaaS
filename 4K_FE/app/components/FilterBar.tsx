'use client';

// 필터 패널 — 연도 범위 슬라이더, 장르/상황 선택, 선호/비선호 영화 관리
import { useEffect, useRef, useState } from 'react';
import { Filters, Movie, GENRES, SITUATIONS } from '@/app/lib/data';

interface FilterBarProps {
  open: boolean;
  draft: Filters;
  movies: Movie[];
  onChangeDraft: (f: Filters) => void;
  onSearch: () => void;
  onReset: () => void;
}

// 단일 선택 pill 행
function FilterRow({ label, options, value, onChange }: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', color: 'rgba(255,255,255,0.5)', width: 90, flexShrink: 0 }}>
        {label.toUpperCase()}
      </span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {options.map((opt) => {
          const active = value === opt;
          return (
            <button
              key={opt}
              onClick={() => onChange(opt)}
              style={{
                padding: '5px 11px',
                background: active ? 'color-mix(in oklch, var(--accent) 18%, transparent)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${active ? 'color-mix(in oklch, var(--accent) 40%, transparent)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 999,
                color: active ? 'var(--accent)' : 'rgba(255,255,255,0.75)',
                fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// 드래그 가능한 듀얼 핸들 연도 범위 슬라이더
function YearRangeRow({ min, max, value, onChange }: {
  min: number;
  max: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
}) {
  const [from, to] = value;
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'from' | 'to' | null>(null);

  // 퍼센트 위치 계산 — track 위 핸들과 활성 구간 렌더링에 사용
  const pctFrom = ((from - min) / (max - min)) * 100;
  const pctTo = ((to - min) / (max - min)) * 100;

  // 드래그 중에만 window 이벤트 등록 — 마우스가 track 밖으로 나가도 추적 가능
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const el = trackRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const v = Math.round(min + pct * (max - min));
      if (dragging === 'from') onChange([Math.min(v, to) as number, to]);
      else onChange([from, Math.max(v, from) as number]);
    };
    const onUp = () => setDragging(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, from, to, min, max, onChange]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', color: 'rgba(255,255,255,0.5)', width: 90, flexShrink: 0 }}>연도</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, maxWidth: 540 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono), monospace', minWidth: 36 }}>{from}</span>
        <div ref={trackRef} style={{ position: 'relative', flex: 1, height: 28, cursor: 'pointer' }}>
          {/* 배경 track */}
          <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 999, transform: 'translateY(-50%)' }} />
          {/* 5년 단위 눈금 */}
          {Array.from({ length: max - min + 1 }, (_, i) => i + min).filter((y) => y % 5 === 0).map((y) => {
            const p = ((y - min) / (max - min)) * 100;
            return (
              <div key={y} style={{ position: 'absolute', left: `${p}%`, top: '50%', width: 1, height: 6, background: 'rgba(255,255,255,0.15)', transform: 'translate(-50%, -50%)' }} />
            );
          })}
          {/* 선택 구간 강조 */}
          <div style={{ position: 'absolute', left: `${pctFrom}%`, right: `${100 - pctTo}%`, top: '50%', height: 3, background: 'var(--accent)', borderRadius: 999, transform: 'translateY(-50%)', boxShadow: '0 0 12px color-mix(in oklch, var(--accent) 50%, transparent)' }} />
          {/* from / to 핸들 */}
          {(['from', 'to'] as const).map((key) => {
            const pct = key === 'from' ? pctFrom : pctTo;
            return (
              <div
                key={key}
                onMouseDown={() => setDragging(key)}
                style={{
                  position: 'absolute', left: `${pct}%`, top: '50%',
                  width: 16, height: 16, borderRadius: 999,
                  background: 'var(--accent)',
                  border: '2px solid #08090d',
                  transform: 'translate(-50%, -50%)',
                  cursor: 'grab',
                  boxShadow: dragging === key ? '0 0 0 6px color-mix(in oklch, var(--accent) 25%, transparent)' : '0 2px 6px rgba(0,0,0,0.5)',
                  transition: 'box-shadow 0.15s',
                }}
              />
            );
          })}
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono), monospace', minWidth: 36 }}>{to}</span>
      </div>
    </div>
  );
}

// 선호/비선호 영화 chip 목록 — tmdb_id로 영화명 조회 후 X 버튼으로 제거
function PrefRow({ label, ids, movies, onRemove, accent }: {
  label: string;
  ids: number[];
  movies: Movie[];
  onRemove: (id: number) => void;
  accent?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', color: 'rgba(255,255,255,0.5)', width: 90, flexShrink: 0 }}>
        {label.toUpperCase()}
      </span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1, minHeight: 26, alignItems: 'center' }}>
        {ids.length === 0 && (
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>등록된 영화가 없습니다</span>
        )}
        {ids.map((id) => {
          const m = movies.find((x) => x.tmdb_id === id);
          if (!m) return null;
          return (
            <span key={id} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '5px 6px 5px 11px',
              background: accent ? 'color-mix(in oklch, var(--accent) 14%, transparent)' : 'rgba(255,255,255,0.06)',
              border: `1px solid ${accent ? 'color-mix(in oklch, var(--accent) 35%, transparent)' : 'rgba(255,255,255,0.12)'}`,
              borderRadius: 999,
              fontSize: 11, fontWeight: 600,
              color: accent ? 'var(--accent)' : 'rgba(255,255,255,0.85)',
            }}>
              {m.title}
              <button
                onClick={() => onRemove(id)}
                style={{
                  width: 16, height: 16, borderRadius: 999, border: 'none',
                  background: accent ? 'color-mix(in oklch, var(--accent) 25%, transparent)' : 'rgba(255,255,255,0.1)',
                  color: 'inherit', cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 0,
                }}
              >
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function FilterBar({ open, draft, movies, onChangeDraft, onSearch, onReset }: FilterBarProps) {
  const removeLike = (id: number) => onChangeDraft({ ...draft, likes: draft.likes.filter((x) => x !== id) });
  const removeDislike = (id: number) => onChangeDraft({ ...draft, dislikes: draft.dislikes.filter((x) => x !== id) });

  return (
    // max-height 트랜지션으로 슬라이드 애니메이션 구현 — height 자체는 애니메이션 불가
    <div style={{
      position: 'sticky', top: 71, zIndex: 4,
      maxHeight: open ? 400 : 0,
      overflow: 'hidden',
      transition: 'max-height 0.35s cubic-bezier(.2,.7,.2,1)',
      borderBottom: open ? '1px solid rgba(255,255,255,0.05)' : '1px solid transparent',
      background: 'rgba(8,9,13,0.85)',
      backdropFilter: 'blur(12px)',
    }}>
      <div style={{ padding: '20px 64px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <YearRangeRow
          min={1980}
          max={2025}
          value={draft.yearRange}
          onChange={(v) => onChangeDraft({ ...draft, yearRange: v })}
        />
        <FilterRow
          label="장르"
          options={['All', ...GENRES]}
          value={draft.genre}
          onChange={(v) => onChangeDraft({ ...draft, genre: v })}
        />
        <FilterRow
          label="상황"
          options={['All', ...SITUATIONS]}
          value={draft.situation}
          onChange={(v) => onChangeDraft({ ...draft, situation: v })}
        />
        <PrefRow label="선호" ids={draft.likes} movies={movies} onRemove={removeLike} accent />
        <PrefRow label="비선호" ids={draft.dislikes} movies={movies} onRemove={removeDislike} />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <button
            onClick={onReset}
            style={{ padding: '9px 16px', background: 'transparent', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
          >
            초기화
          </button>
          <button
            onClick={onSearch}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 22px', background: 'var(--accent)', color: 'black', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', boxShadow: '0 0 24px color-mix(in oklch, var(--accent) 30%, transparent)' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
            검색
          </button>
        </div>
      </div>
    </div>
  );
}
