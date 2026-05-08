'use client';

import { useRef, useState, useId } from 'react';

interface ClimaxGraphProps {
  data: number[];
  color?: string;
  showHover?: boolean;
  strokeWidth?: number;
  glow?: boolean;
  onHover?: (idx: number | null) => void;
}

export default function ClimaxGraph({
  data,
  color = 'var(--accent)',
  showHover = true,
  strokeWidth = 2.5,
  glow = true,
  onHover,
}: ClimaxGraphProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const width = 600;
  const height = 180;
  const padX = 8;
  const padY = 14;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const gradId = useId();
  const glowId = useId();

  const toPath = (arr: number[]) => {
    const pts = arr.map((v, i) => [
      padX + (i / (arr.length - 1)) * innerW,
      padY + innerH - (v / 100) * innerH,
    ]);
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      const cpx = (p0[0] + p1[0]) / 2;
      d += ` C${cpx},${p0[1]} ${cpx},${p1[1]} ${p1[0]},${p1[1]}`;
    }
    return d;
  };

  const linePath = toPath(data);
  const areaPath = `${linePath} L${padX + innerW},${padY + innerH} L${padX},${padY + innerH} Z`;

  const hoverPoint = hoverIdx !== null
    ? [padX + (hoverIdx / (data.length - 1)) * innerW, padY + innerH - (data[hoverIdx] / 100) * innerH]
    : null;

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!showHover) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const idx = Math.round(((x - padX) / innerW) * (data.length - 1));
    const clamped = Math.max(0, Math.min(data.length - 1, idx));
    setHoverIdx(clamped);
    onHover?.(clamped);
  };

  const handleLeave = () => {
    setHoverIdx(null);
    onHover?.(null);
  };

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: '100%', display: 'block', cursor: showHover ? 'crosshair' : 'default' }}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    >
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.45" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
        {glow && (
          <filter id={glowId} x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        )}
      </defs>

      <g opacity="0.18">
        {[0.25, 0.5, 0.75].map((t) => (
          <line
            key={t}
            x1={padX}
            x2={padX + innerW}
            y1={padY + innerH * t}
            y2={padY + innerH * t}
            stroke="white"
            strokeDasharray="2 4"
            strokeWidth="0.5"
          />
        ))}
      </g>

      <path d={areaPath} fill={`url(#${gradId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        filter={glow ? `url(#${glowId})` : undefined}
      />

      {hoverPoint && (
        <g>
          <line
            x1={hoverPoint[0]} x2={hoverPoint[0]}
            y1={padY} y2={padY + innerH}
            stroke="white" strokeOpacity="0.3" strokeWidth="0.8" strokeDasharray="2 2"
          />
          <circle cx={hoverPoint[0]} cy={hoverPoint[1]} r="6" fill={color} fillOpacity="0.25" />
          <circle cx={hoverPoint[0]} cy={hoverPoint[1]} r="3" fill={color} />
        </g>
      )}
    </svg>
  );
}
