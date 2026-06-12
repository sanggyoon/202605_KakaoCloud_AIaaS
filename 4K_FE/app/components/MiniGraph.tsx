'use client';

import { toDisplayScale } from '@/app/lib/climax';

// 클라이맥스 곡선(z-score)을 고정 display 스케일로 베지어 렌더링
interface MiniGraphProps {
  data: number[];
  color?: string;
  height?: number;
  reference?: number[];   // 비교용 점선 곡선(현재 영화)
}

export default function MiniGraph({ data, color = 'var(--accent)', height = 40, reference }: MiniGraphProps) {
  const width = 140;
  const padX = 2;
  const innerW = width - padX * 2;
  const innerH = height - 4;
  // 값을 고정 display 스케일(0~100)로 변환 후 SVG 좌표로 — Y축은 상단이 0이므로 반전
  const ds = toDisplayScale(data);
  const pts = data.map((_, i) => [padX + (i / (data.length - 1)) * innerW, 2 + innerH - (ds[i] / 100) * innerH]);

  // 인접 점 사이의 중간 x를 제어점으로 사용하는 cubic bezier — 부드러운 곡선 생성
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const cpx = (p0[0] + p1[0]) / 2;
    d += ` C${cpx},${p0[1]} ${cpx},${p1[1]} ${p1[0]},${p1[1]}`;
  }

  // reference 곡선 경로(있을 때만)
  let refD = '';
  if (reference && reference.length > 1) {
    const rs = toDisplayScale(reference);
    const rpts = reference.map((_, i) => [padX + (i / (reference.length - 1)) * innerW, 2 + innerH - (rs[i] / 100) * innerH]);
    refD = `M${rpts[0][0]},${rpts[0][1]}`;
    for (let i = 0; i < rpts.length - 1; i++) {
      const cpx = (rpts[i][0] + rpts[i + 1][0]) / 2;
      refD += ` C${cpx},${rpts[i][1]} ${cpx},${rpts[i + 1][1]} ${rpts[i + 1][0]},${rpts[i + 1][1]}`;
    }
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      {refD && (
        <path d={refD} fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="1.2"
              strokeDasharray="3 3" strokeLinecap="round" />
      )}
      {/* 곡선 아래 채움 영역 */}
      <path d={`${d} L${padX + innerW},${height} L${padX},${height} Z`} fill={color} fillOpacity="0.15" />
      {/* 곡선 선 */}
      <path d={d} fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
