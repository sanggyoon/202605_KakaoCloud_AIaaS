'use client';

// 필터 패널 — 연도 범위 슬라이더, 선호/비선호 장르 선택, 선호/비선호 영화 관리
import { useEffect, useRef, useState } from 'react';
import { Filters, Movie, GENRES } from '@/app/lib/data';

interface FilterBarProps {
  open: boolean;
  draft: Filters;
  movies: Movie[];
  onChangeDraft: (f: Filters) => void;
  onSearch: () => void;
  onReset: () => void;
  search: string;
  onSearchChange: (v: string) => void;
}

// 단일 선택 pill 행
function FilterRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center items-start gap-2 md:gap-[14px]">
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.16em',
          color: 'rgba(255,255,255,0.5)',
          width: 90,
          flexShrink: 0,
        }}
      >
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
                background: active
                  ? 'color-mix(in oklch, var(--accent) 18%, transparent)'
                  : 'rgba(255,255,255,0.04)',
                border: `1px solid ${active ? 'color-mix(in oklch, var(--accent) 40%, transparent)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 999,
                color: active ? 'var(--accent)' : 'rgba(255,255,255,0.75)',
                fontSize: 11,
                fontWeight: 600,
                fontFamily: 'inherit',
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

// 다중 선택 pill 행 (비선호 장르용)
function MultiFilterRow({
  label,
  options,
  values,
  onChange,
}: {
  label: string;
  options: string[];
  values: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center items-start gap-2 md:gap-[14px]">
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.16em',
          color: 'rgba(255,255,255,0.5)',
          width: 90,
          flexShrink: 0,
        }}
      >
        {label.toUpperCase()}
      </span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {options.map((opt) => {
          const active = values.includes(opt);
          return (
            <button
              key={opt}
              onClick={() =>
                onChange(
                  active ? values.filter((v) => v !== opt) : [...values, opt],
                )
              }
              style={{
                padding: '5px 11px',
                background: active
                  ? 'rgba(255,80,80,0.15)'
                  : 'rgba(255,255,255,0.04)',
                border: `1px solid ${active ? 'rgba(255,100,100,0.45)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 999,
                color: active ? '#ff7070' : 'rgba(255,255,255,0.75)',
                fontSize: 11,
                fontWeight: 600,
                fontFamily: 'inherit',
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

// 좌우 화살표 버튼 + 클릭 직접 입력이 가능한 연도 스텝퍼
function EditableYear({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(String(value));

  useEffect(() => {
    if (!editing) setInput(String(value));
  }, [value, editing]);

  const commit = () => {
    const n = parseInt(input, 10);
    if (!isNaN(n)) {
      onChange(Math.max(min, Math.min(max, n)));
    } else {
      setInput(String(value));
    }
    setEditing(false);
  };

  const arrowBtn = (disabled: boolean): React.CSSProperties => ({
    display: 'grid',
    placeItems: 'center',
    width: 32, 
    height: 36, 
    background: 'none',
    border: 'none',
    color: disabled ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.55)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    flexShrink: 0,
    transition: 'color 0.15s',
  });

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 7,
        overflow: 'hidden',
        minWidth: 106, 
      }}
    >
      <button
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        style={arrowBtn(value <= min)}
      >
        <svg
          width="14" 
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>

      {editing ? (
        <input
          type="number"
          value={input}
          min={min}
          max={max}
          onChange={(e) => setInput(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setInput(String(value));
              setEditing(false);
            }
          }}
          autoFocus
          style={{
            width: 50, 
            padding: '0 4px',
            height: 36, 
            background: 'transparent',
            border: 'none',
            color: 'var(--accent)',
            fontSize: 14, 
            fontWeight: 700,
            fontFamily: 'var(--font-mono), monospace',
            outline: 'none',
            textAlign: 'center',
          }}
        />
      ) : (
        <span
          onClick={() => {
            setInput(String(value));
            setEditing(true);
          }}
          title="클릭하여 직접 입력"
          style={{
            width: 50, 
            height: 36, 
            lineHeight: '36px', 
            textAlign: 'center',
            cursor: 'text',
            fontSize: 14, 
            fontWeight: 700,
            color: 'var(--accent)',
            fontFamily: 'var(--font-mono), monospace',
            userSelect: 'none',
          }}
        >
          {value}
        </span>
      )}

      <button
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        style={arrowBtn(value >= max)}
      >
        <svg
          width="14" 
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
    </div>
  );
}

// 드래그 가능한 듀얼 핸들 연도 범위 슬라이더
function YearRangeRow({
  min,
  max,
  value,
  onChange,
}: {
  min: number;
  max: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'from' | 'to' | null>(null);

  const from = Math.max(min, Math.min(value[0], value[1]));
  const to = Math.min(max, Math.max(value[1], value[0]));
  const range = max - min || 1; 
  const pctFrom = ((from - min) / range) * 100;
  const pctTo = ((to - min) / range) * 100;

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent | TouchEvent) => {
      const el = trackRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      const v = Math.round(min + pct * range);
      if (dragging === 'from') onChange([Math.min(v, to), to]);
      else onChange([from, Math.max(v, from)]);
    };
    const onUp = () => setDragging(null);
    
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [dragging, from, to, min, max, range, onChange]);

  return (
    <div className="flex flex-col md:flex-row md:items-center items-start gap-2 md:gap-[14px] w-full">
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.16em',
          color: 'rgba(255,255,255,0.5)',
          width: 90,
          flexShrink: 0,
        }}
      >
        연도
      </span>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8, 
          flex: 1,
          width: '100%',
          maxWidth: 540,
        }}
      >
        <EditableYear value={from} min={min} max={to} onChange={(v) => onChange([v, to])} />
        <div
          ref={trackRef}
          style={{
            position: 'relative',
            flex: 1,
            height: 36, 
            cursor: 'pointer',
            minWidth: 50, 
            touchAction: 'none',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0, right: 0, top: '50%', height: 3,
              background: 'rgba(255,255,255,0.08)',
              borderRadius: 999, transform: 'translateY(-50%)',
            }}
          />
          {Array.from({ length: max - min + 1 }, (_, i) => i + min)
            .filter((y) => y % 5 === 0)
            .map((y) => {
              const p = ((y - min) / range) * 100;
              return (
                <div
                  key={y}
                  style={{
                    position: 'absolute', left: `${p}%`, top: '50%',
                    width: 1, height: 6, background: 'rgba(255,255,255,0.15)',
                    transform: 'translate(-50%, -50%)',
                  }}
                />
              );
            })}
          <div
            style={{
              position: 'absolute', left: `${pctFrom}%`, right: `${100 - pctTo}%`,
              top: '50%', height: 3, background: 'var(--accent)',
              borderRadius: 999, transform: 'translateY(-50%)',
              boxShadow: '0 0 12px color-mix(in oklch, var(--accent) 50%, transparent)',
            }}
          />
          {(['from', 'to'] as const).map((key) => {
            const pct = key === 'from' ? pctFrom : pctTo;
            return (
              <div
                key={key}
                onMouseDown={() => setDragging(key)}
                onTouchStart={() => setDragging(key)}
                style={{
                  position: 'absolute', left: `${pct}%`, top: '50%',
                  width: 16, height: 16, borderRadius: 999,
                  background: 'var(--accent)', border: '2px solid #08090d',
                  transform: 'translate(-50%, -50%)', cursor: 'grab',
                  boxShadow: dragging === key
                      ? '0 0 0 6px color-mix(in oklch, var(--accent) 25%, transparent)'
                      : '0 2px 6px rgba(0,0,0,0.5)',
                  transition: 'box-shadow 0.15s',
                }}
              />
            );
          })}
        </div>
        <EditableYear value={to} min={from} max={max} onChange={(v) => onChange([from, v])} />
      </div>
    </div>
  );
}

// 선호/비선호 영화 chip 목록
function PrefRow({
  label,
  ids,
  movies,
  onRemove,
  accent,
}: {
  label: string;
  ids: number[];
  movies: Movie[];
  onRemove: (id: number) => void;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center items-start gap-2 md:gap-[14px]">
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.16em',
          color: 'rgba(255,255,255,0.5)',
          width: 90,
          flexShrink: 0,
        }}
      >
        {label.toUpperCase()}
      </span>
      <div
        style={{
          display: 'flex', gap: 6, flexWrap: 'wrap',
          flex: 1, minHeight: 26, alignItems: 'center',
        }}
      >
        {ids.length === 0 && (
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
            등록된 영화가 없습니다
          </span>
        )}
        {ids.map((id) => {
          const m = movies.find((x) => x.tmdb_id === id);
          if (!m) return null;
          return (
            <span
              key={id}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '5px 6px 5px 11px',
                background: accent ? 'color-mix(in oklch, var(--accent) 14%, transparent)' : 'rgba(255,255,255,0.06)',
                border: `1px solid ${accent ? 'color-mix(in oklch, var(--accent) 35%, transparent)' : 'rgba(255,255,255,0.12)'}`,
                borderRadius: 999, fontSize: 11, fontWeight: 600,
                color: accent ? 'var(--accent)' : 'rgba(255,255,255,0.85)',
              }}
            >
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

export default function FilterBar({
  open,
  draft,
  movies,
  onChangeDraft,
  onSearch,
  onReset,
  search,
  onSearchChange,
}: FilterBarProps) {
  const removeLike = (id: number) =>
    onChangeDraft({ ...draft, likes: draft.likes.filter((x) => x !== id) });
  const removeDislike = (id: number) =>
    onChangeDraft({
      ...draft,
      dislikes: draft.dislikes.filter((x) => x !== id),
    });

  const dataMin = 1900;
  const dataMax = new Date().getFullYear();

  // ✨ [핵심 해결] 필터바가 열리면 뒤에 있는 포스터 배경의 스크롤을 완전히 잠가버립니다!
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'; 
    } else {
      document.body.style.overflow = ''; 
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <div
      style={{
        maxHeight: open ? 3000 : 0, 
        overflow: 'hidden',
        transition: 'max-height 0.35s cubic-bezier(.2,.7,.2,1)',
        borderBottom: open
          ? '1px solid rgba(255,255,255,0.05)'
          : '1px solid transparent',
        background: 'rgba(8,9,13,0.85)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div
        className="filter-bar-inner"
        style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          gap: 16, 
          // ✨ 뒷배경이 멈췄으니, 이제 필터 안에서만 스크롤 되도록 다시 세팅합니다!
          maxHeight: 'calc(100vh - 80px)', // 헤더 크기만큼 빼서 버튼이 화면 안에 무조건 들어오게 방어
          overflowY: 'auto', 
          paddingBottom: '40px' // 버튼 아래 여유 공간 넉넉히!
        }}
      >
        <div className="filter-mobile-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="영화 제목 검색..."
          />
        </div>
        <YearRangeRow
          min={dataMin}
          max={dataMax}
          value={draft.yearRange}
          onChange={(v) => onChangeDraft({ ...draft, yearRange: v })}
        />
        <FilterRow
          label="선호 장르"
          options={['All', ...GENRES]}
          value={draft.genre}
          onChange={(v) =>
            onChangeDraft({
              ...draft,
              genre: v,
              dislikeGenres: draft.dislikeGenres.filter((g) => g !== v),
            })
          }
        />
        <MultiFilterRow
          label="비선호 장르"
          options={GENRES}
          values={draft.dislikeGenres}
          onChange={(v) =>
            onChangeDraft({
              ...draft,
              dislikeGenres: v,
              genre: v.includes(draft.genre) ? 'All' : draft.genre,
            })
          }
        />
        <PrefRow label="선호 영화" ids={draft.likes} movies={movies} onRemove={removeLike} accent />
        <PrefRow label="비선호 영화" ids={draft.dislikes} movies={movies} onRemove={removeDislike} />

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 8,
            paddingTop: 14,
            borderTop: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <button
            onClick={onReset}
            style={{
              padding: '9px 16px',
              background: 'transparent',
              color: 'rgba(255,255,255,0.6)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            초기화
          </button>
          <button
            onClick={onSearch}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '9px 22px',
              background: 'var(--accent)',
              color: 'black',
              border: 'none',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              fontFamily: 'inherit',
              cursor: 'pointer',
              boxShadow: '0 0 24px color-mix(in oklch, var(--accent) 30%, transparent)',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            검색
          </button>
        </div>
      </div>
    </div>
  );
}