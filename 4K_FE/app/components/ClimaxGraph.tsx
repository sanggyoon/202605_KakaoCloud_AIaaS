'use client';

import { toDisplayScale } from '@/app/lib/climax';

// 클라이맥스 곡선 — 영화별 min/max 정규화 + 네온 글로우, 최고 정점에 PEAK 마커
interface ClimaxGraphProps {
  data: number[];
  height?: number;
}

export default function ClimaxGraph({ data, height = 320 }: ClimaxGraphProps) {
  const W = 600;
  const H = height;
  const padX = 8;
  const padY = 30;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const toY = (val: number) => padY + innerH - ((val - min) / range) * innerH;
  const toX = (i: number) => padX + (i / (data.length - 1)) * innerW;

  const pts = data.map((val, i) => [toX(i), toY(val)]);

  // cubic bezier — 인접 점의 중간 x를 제어점으로
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const cpx = (pts[i][0] + pts[i + 1][0]) / 2;
    d += ` C${cpx},${pts[i][1]} ${cpx},${pts[i + 1][1]} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  const fillD = `${d} L${padX + innerW},${H} L${padX},${H} Z`;

  // 최고 정점 → PEAK 마커
  let argmax = 0;
  for (let i = 1; i < data.length; i++) if (data[i] > data[argmax]) argmax = i;
  const peakPct = Math.round(toDisplayScale(data)[argmax]);
  const peakLeft = (toX(argmax) / W) * 100;
  const peakTop = (toY(data[argmax]) / H) * 100;

  return (
    <div style={{ position: 'relative', width: '100%', height }}>
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

      {/* PEAK 정점 — 빛나는 점 */}
      <div
        style={{
          position: 'absolute', left: `${peakLeft}%`, top: `${peakTop}%`,
          transform: 'translate(-50%, -50%)', pointerEvents: 'none',
          width: 13, height: 13, borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 0 18px 5px rgba(123,97,255,0.85), 0 0 6px 1px var(--accent)',
        }}
      />
      {/* PEAK 라벨 */}
      <div
        style={{
          position: 'absolute', left: `${peakLeft}%`, top: `${peakTop}%`,
          transform: 'translate(-50%, calc(-100% - 18px))',
          textAlign: 'center', pointerEvents: 'none', whiteSpace: 'nowrap',
        }}
      >
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.24em', color: 'var(--accent)' }}>PEAK</div>
        <div style={{ fontFamily: 'var(--font-playfair), serif', fontWeight: 800, fontSize: 26, color: '#fff', lineHeight: 1.05 }}>
          {peakPct}%
        </div>
      </div>
    </div>
  );
}
