'use client';

import { useId } from 'react';
import { toDisplayScale } from '@/app/lib/climax';
import { valenceGradientStops } from '@/app/lib/color';
import { catmullRomPath } from '@/app/lib/svgPath';

// arousal=높이(고정 display 스케일), valence=색(있을 때).
interface MiniGraphProps {
  data: number[];        // arousal
  valence?: number[];    // valence (색)
  color?: string;
  height?: number;
}

export default function MiniGraph({ data, valence, color = 'var(--accent)', height = 40 }: MiniGraphProps) {
  const gid = 'mg' + useId().replace(/:/g, '');
  const width = 140;
  const padX = 2;
  const innerW = width - padX * 2;
  const innerH = height - 4;
  const ds = toDisplayScale(data);
  const pts = data.map((_, i) => [padX + (i / (data.length - 1)) * innerW, 2 + innerH - (ds[i] / 100) * innerH]);

  const d = catmullRomPath(pts);

  const stops = valence ? valenceGradientStops(valence) : [];
  const stroke = stops.length ? `url(#${gid})` : color;
  const fill = stops.length ? stops[Math.floor(stops.length / 2)].color : color;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
      {stops.length > 0 && (
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
            {stops.map((s, i) => (
              <stop key={i} offset={`${(s.offset * 100).toFixed(1)}%`} stopColor={s.color} />
            ))}
          </linearGradient>
        </defs>
      )}
      {/* 곡선 아래 채움 */}
      <path d={`${d} L${padX + innerW},${height} L${padX},${height} Z`} fill={fill} fillOpacity="0.12" />
      {/* 곡선 선 */}
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
