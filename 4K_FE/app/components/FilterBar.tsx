'use client';

import { useEffect, useRef, useState } from 'react';
import { MOVIES, GENRES, SITUATIONS } from '@/app/lib/data';

interface Filters {
  yearRange: [number, number];
  genre: string;
  situation: string;
  likes: string[];
  dislikes: string[];
}

interface FilterBarProps {
  open: boolean;
  draft: Filters;
  onChangeDraft: (f: Filters) => void;
  onSearch: () => void;
  onReset: () => void;
}

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

function YearRangeRow({ min, max, value, onChange }: {
  min: number;
  max: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
}) {
  const [from, to] = value;
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'from' | 'to' | null>(null);

  const pctFrom = ((from - min) / (max - min)) * 100;
  const pctTo = ((to - min) / (max - min)) * 100;

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
          <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 999, transform: 'translateY(-50%)' }} />
          {Array.from({ length: max - min + 1 }, (_, i) => i + min).map((y) => {
            const p = ((y - min) / (max - min)) * 100;
            return (
              <div key={y} style={{ position: 'absolute', left: `${p}%`, top: '50%', width: 1, height: 6, background: 'rgba(255,255,255,0.15)', transform: 'translate(-50%, -50%)' }} />
            );
          })}
          <div style={{ position: 'absolute', left: `${pctFrom}%`, right: `${100 - pctTo}%`, top: '50%', height: 3, background: 'var(--accent)', borderRadius: 999, transform: 'translateY(-50%)', boxShadow: '0 0 12px color-mix(in oklch, var(--accent) 50%, transparent)' }} />
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

function PrefRow({ label, ids, onRemove, accent }: {
  label: string;
  ids: string[];
  onRemove: (id: string) => void;
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
          const m = MOVIES.find((x) => x.id === id);
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
                  width: 16, height: 16, borderRadius: 999,
                  border: 'none',
                  background: accent ? 'color-mix(in oklch, var(--accent) 25%, transparent)' : 'rgba(255,255,255,0.1)',
                  color: 'inherit',
                  cursor: 'pointer',
                  display: 'grid', placeItems: 'center',
                  padding: 0,
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

export default function FilterBar({ open, draft, onChangeDraft, onSearch, onReset }: FilterBarProps) {
  const removeLike = (id: string) => onChangeDraft({ ...draft, likes: draft.likes.filter((x) => x !== id) });
  const removeDislike = (id: string) => onChangeDraft({ ...draft, dislikes: draft.dislikes.filter((x) => x !== id) });

  return (
    <div style={{
      position: 'relative', zIndex: 4,
      maxHeight: open ? 520 : 0,
      overflow: 'hidden',
      transition: 'max-height 0.35s cubic-bezier(.2,.7,.2,1)',
      borderBottom: open ? '1px solid rgba(255,255,255,0.05)' : '1px solid transparent',
      background: 'rgba(255,255,255,0.018)',
    }}>
      <div style={{ padding: '20px 64px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <YearRangeRow
          min={2010}
          max={2024}
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
        <PrefRow label="선호" ids={draft.likes} onRemove={removeLike} accent />
        <PrefRow label="비선호" ids={draft.dislikes} onRemove={removeDislike} />

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
