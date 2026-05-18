'use client';

// 클라이맥스 그래프 SVG 컴포넌트 — 0~100 강도 배열을 베지어 곡선으로 렌더링
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
  // data 값(0~100)을 SVG 좌표로 변환 — Y축은 상단이 0이므로 반전
  const pts = data.map((v, i) => [padX + (i / (data.length - 1)) * innerW, 2 + innerH - (v / 100) * innerH]);

  // 인접 점 사이의 중간 x를 제어점으로 사용하는 cubic bezier — 부드러운 곡선 생성
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
      {/* 곡선 아래 채움 영역 */}
      <path d={`${d} L${padX + innerW},${height} L${padX},${height} Z`} fill={color} fillOpacity="0.15" />
      {/* 곡선 선 */}
      <path d={d} fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
