'use client';

// z-score 정규화된 200포인트 벡터를 클라이맥스 곡선으로 렌더링
interface ClimaxGraphProps {
  data: number[];
  height?: number;
  markers?: { index: number; label: string }[];
}

export default function ClimaxGraph({ data, height = 160, markers = [] }: ClimaxGraphProps) {
  const W = 600;
  const H = height;
  const padX = 8;
  const padY = 14;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  // 값 → SVG Y좌표 (위쪽이 높은 값)
  const toY = (v: number) => padY + innerH - ((v - min) / range) * innerH;
  const toX = (i: number) => padX + (i / (data.length - 1)) * innerW;

  const pts = data.map((v, i) => [toX(i), toY(v)]);

  // cubic bezier — 인접 점의 중간 x를 제어점으로 사용
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const cpx = (pts[i][0] + pts[i + 1][0]) / 2;
    d += ` C${cpx},${pts[i][1]} ${cpx},${pts[i + 1][1]} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }

  const fillD = `${d} L${padX + innerW},${H} L${padX},${H} Z`;

  // z=0 기준선 (평균) SVG Y좌표
  const baselineY = toY(0);

  return (
    <div style={{ position: 'relative', width: '100%', height }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: '100%', display: 'block', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id="cgFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.03" />
          </linearGradient>
        </defs>

        {/* 평균 기준선 */}
        <line
          x1={padX} y1={baselineY}
          x2={padX + innerW} y2={baselineY}
          stroke="rgba(255,255,255,0.1)"
          strokeWidth="1"
          strokeDasharray="5 5"
        />

        {/* 채움 + 곡선 — 바닥에서 위로 자라나며 차오르는 그룹 */}
        <g className="climax-grow">
          <path d={fillD} fill="url(#cgFill)" />
          <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>

      {/* 시작 / 결말 레이블 */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        display: 'flex', justifyContent: 'space-between',
        fontSize: 9, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.12em', fontWeight: 600,
        padding: '0 2px',
      }}>
        <span>시작</span>
        <span>결말</span>
      </div>

      {/* 피크 마커 — toX/toY를 %로 환산해 HTML 배지로(SVG는 stretch라 왜곡) */}
      {markers.map((mk) => {
        const leftPct = (toX(mk.index) / W) * 100;
        const topPct = (toY(data[mk.index]) / H) * 100;
        return (
          <div
            key={mk.index}
            style={{
              position: 'absolute', left: `${leftPct}%`, top: `${topPct}%`,
              transform: 'translate(-50%, -50%)',
              width: 24, height: 24, borderRadius: '50%',
              background: 'var(--accent)', color: '#0a0a0f',
              display: 'grid', placeItems: 'center',
              fontSize: 11, fontWeight: 800,
              boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
              pointerEvents: 'none',
            }}
          >
            {mk.label}
          </div>
        );
      })}
    </div>
  );
}
