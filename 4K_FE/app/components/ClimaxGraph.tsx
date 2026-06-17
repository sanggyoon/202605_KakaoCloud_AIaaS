'use client';

import { useRef, useState } from 'react';
import { toDisplayScale } from '@/app/lib/climax';
import { valenceGradientStops, valenceToUnit, valenceColorAt } from '@/app/lib/color';
import { catmullRomPath } from '@/app/lib/svgPath';

// arousal=높이, valence=색(있을 때). 호버 시 십자선 + 진행도/피크/분위기 툴팁.
interface ClimaxGraphProps {
  data: number[];        // arousal
  valence?: number[];    // valence (색)
  height?: number;
}

export default function ClimaxGraph({ data, valence, height = 380 }: ClimaxGraphProps) {
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

  const pts = data.map((val, i) => [toX(i), toY(val)]);
  const d = catmullRomPath(pts);
  const fillD = `${d} L${padX + innerW},${H} L${padX},${H} Z`;

  const stops = valence ? valenceGradientStops(valence) : [];
  const vUnit = valence ? valenceToUnit(valence) : [];
  const stroke = stops.length ? 'url(#cgValence)' : 'var(--accent)';

  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  // 마운트 시 그래프를 왼쪽→오른쪽으로 그려내는 1회성 wipe. 끝나면 클래스를 떼어
  // 잔여 clip-path가 글로우를 자르지 않게 한다. (prefers-reduced-motion 시 즉시 표시)
  const [drawn, setDrawn] = useState(false);
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover(Math.round(fx * (data.length - 1)));
  };

  const hx = hover !== null ? (toX(hover) / W) * 100 : 0;
  const hy = hover !== null ? (toY(data[hover]) / H) * 100 : 0;
  const progress = hover !== null ? Math.round((hover / (data.length - 1)) * 100) : 0;
  const peakPct = hover !== null ? Math.round(toDisplayScale(data)[hover]) : 0;
  const moodU = hover !== null && vUnit.length ? vUnit[hover] : null;
  const moodColor = moodU !== null ? valenceColorAt(moodU) : '#fff';
  const moodLabel = moodU === null ? '' : moodU < 0.33 ? '어두움' : moodU < 0.66 ? '중립' : '밝음';
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
        className={drawn ? undefined : 'cg-draw'}
        onAnimationEnd={() => setDrawn(true)}
        style={{ width: '100%', height: '100%', display: 'block', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id="cgFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.015" />
          </linearGradient>
          {stops.length > 0 && (
            <linearGradient id="cgValence" x1="0" y1="0" x2="1" y2="0">
              {stops.map((s, i) => (
                <stop key={i} offset={`${(s.offset * 100).toFixed(1)}%`} stopColor={s.color} />
              ))}
            </linearGradient>
          )}
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
          stroke={stroke}
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          filter="url(#cgGlow)"
        />
      </svg>

      {hover !== null && (
        <>
          <div style={{ position: 'absolute', left: `${hx}%`, top: 0, bottom: 0, width: 1, background: 'rgba(123,97,255,0.45)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', top: `${hy}%`, left: 0, right: 0, height: 1, background: 'rgba(123,97,255,0.45)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', left: `${hx}%`, top: `${hy}%`, transform: 'translate(-50%, -50%)', width: 11, height: 11, borderRadius: '50%', background: moodColor, boxShadow: `0 0 14px 4px ${moodColor}`, pointerEvents: 'none' }} />
          <div
            style={{
              position: 'absolute', left: `${tipLeft}%`, top: `${hy}%`,
              transform: tipBelow ? 'translate(-50%, 16px)' : 'translate(-50%, calc(-100% - 16px))',
              pointerEvents: 'none', whiteSpace: 'nowrap',
              background: 'rgba(15,14,22,0.92)', border: '1px solid rgba(123,97,255,0.4)',
              borderRadius: 8, padding: '8px 12px', backdropFilter: 'blur(4px)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.4)' }}>진행도</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', lineHeight: 1.2 }}>{progress}%</div>
              </div>
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--accent)' }}>피크</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--accent)', lineHeight: 1.2 }}>{peakPct}%</div>
              </div>
              {moodU !== null && (
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.4)' }}>분위기</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                    <span style={{ width: 11, height: 11, borderRadius: '50%', background: moodColor }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{moodLabel}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
