'use client';

import { useRef, useState } from 'react';
import { toDisplayScale } from '@/app/lib/climax';

// 클라이맥스 곡선 — 영화별 min/max 정규화 + 네온 글로우.
// 마우스 호버 시 십자선(진행도/피크)과 해당 지점 값 툴팁 표시.
interface ClimaxGraphProps {
  data: number[];
  height?: number;
}

export default function ClimaxGraph({ data, height = 380 }: ClimaxGraphProps) {
  const W = 600;
  const H = height;
  const padX = 8;
  const padY = 64;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const toY = (val: number) => padY + innerH - ((val - min) / range) * innerH;
  const toX = (i: number) => padX + (i / (data.length - 1)) * innerW;

  const display = toDisplayScale(data);
  const pts = data.map((val, i) => [toX(i), toY(val)]);

  // cubic bezier — 인접 점의 중간 x를 제어점으로
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const cpx = (pts[i][0] + pts[i + 1][0]) / 2;
    d += ` C${cpx},${pts[i][1]} ${cpx},${pts[i + 1][1]} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  const fillD = `${d} L${padX + innerW},${H} L${padX},${H} Z`;

  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover(Math.round(fx * (data.length - 1)));
  };

  // 호버 지점 좌표/값
  const hx = hover !== null ? (toX(hover) / W) * 100 : 0;
  const hy = hover !== null ? (toY(data[hover]) / H) * 100 : 0;
  const progress = hover !== null ? Math.round((hover / (data.length - 1)) * 100) : 0;
  const peakPct = hover !== null ? Math.round(display[hover]) : 0;
  const tipLeft = Math.min(86, Math.max(14, hx));
  const tipBelow = hy < 16;

  return (
    <div
      ref={containerRef}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
      style={{ position: 'relative', width: '100%', height, cursor: 'crosshair' }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: '100%', display: 'block', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id="cgFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.015" />
          </linearGradient>
          <filter id="cgGlow" x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path d={fillD} fill="url(#cgFill)" />
        <path
          d={d}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#cgGlow)"
        />
      </svg>

      {hover !== null && (
        <>
          {/* 세로선 — 진행도 축 */}
          <div style={{ position: 'absolute', left: `${hx}%`, top: 0, bottom: 0, width: 1, background: 'rgba(123,97,255,0.45)', pointerEvents: 'none' }} />
          {/* 가로선 — 피크 축 */}
          <div style={{ position: 'absolute', top: `${hy}%`, left: 0, right: 0, height: 1, background: 'rgba(123,97,255,0.45)', pointerEvents: 'none' }} />
          {/* 교차점 */}
          <div style={{
            position: 'absolute', left: `${hx}%`, top: `${hy}%`, transform: 'translate(-50%, -50%)',
            width: 11, height: 11, borderRadius: '50%', background: '#fff',
            boxShadow: '0 0 14px 4px rgba(123,97,255,0.85)', pointerEvents: 'none',
          }} />
          {/* 툴팁 */}
          <div style={{
            position: 'absolute', left: `${tipLeft}%`, top: `${hy}%`,
            transform: tipBelow ? 'translate(-50%, 16px)' : 'translate(-50%, calc(-100% - 16px))',
            pointerEvents: 'none', whiteSpace: 'nowrap',
            background: 'rgba(15,14,22,0.92)', border: '1px solid rgba(123,97,255,0.4)',
            borderRadius: 8, padding: '8px 12px', backdropFilter: 'blur(4px)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
          }}>
            <div style={{ display: 'flex', gap: 14 }}>
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.4)' }}>진행도</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', lineHeight: 1.2 }}>{progress}%</div>
              </div>
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--accent)' }}>피크</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--accent)', lineHeight: 1.2 }}>{peakPct}%</div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
