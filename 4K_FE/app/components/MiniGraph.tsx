'use client';

interface MiniGraphProps {
  data: number[];
  color?: string;
  height?: number;
}

export default function MiniGraph({ data, color = 'var(--accent)', height = 40 }: MiniGraphProps) {
  const width = 140;
  const padX = 2;
  const innerW = width - padX * 2;
  const innerH = height - 4;
  const pts = data.map((v, i) => [padX + (i / (data.length - 1)) * innerW, 2 + innerH - (v / 100) * innerH]);

  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const cpx = (p0[0] + p1[0]) / 2;
    d += ` C${cpx},${p0[1]} ${cpx},${p1[1]} ${p1[0]},${p1[1]}`;
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      <path d={`${d} L${padX + innerW},${height} L${padX},${height} Z`} fill={color} fillOpacity="0.15" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
