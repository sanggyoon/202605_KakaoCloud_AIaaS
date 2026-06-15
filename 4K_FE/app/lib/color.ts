// valence(감정 톤) → 곡선 색. 팔레트 A(teal→purple→pink), 영화별 정규화. (순수)

const PALETTE_A: [number, number, number][] = [
  [45, 212, 191],   // teal  (부정)
  [123, 97, 255],   // purple(중립)
  [255, 110, 199],  // pink  (긍정)
];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}
function hex(c: number[]): string {
  return '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('');
}

// 0~1 → 3-stop diverging 색 (clamp)
export function valenceColorAt(t: number): string {
  const u = Math.min(1, Math.max(0, t));
  const [lo, mid, hi] = PALETTE_A;
  const c =
    u < 0.5
      ? [0, 1, 2].map((i) => lerp(lo[i], mid[i], u / 0.5))
      : [0, 1, 2].map((i) => lerp(mid[i], hi[i], (u - 0.5) / 0.5));
  return hex(c);
}

// 영화별 정규화: (v-min)/(max-min) → 0~1
export function valenceToUnit(valence: number[]): number[] {
  if (valence.length === 0) return [];
  const min = Math.min(...valence);
  const max = Math.max(...valence);
  const range = max - min || 1;
  return valence.map((v) => (v - min) / range);
}

export interface GradientStop {
  offset: number; // 0~1
  color: string;
}

// SVG linearGradient stop 배열. 길이<2면 [].
export function valenceGradientStops(valence: number[], n = 48): GradientStop[] {
  if (valence.length < 2) return [];
  const u = valenceToUnit(valence);
  const stops: GradientStop[] = [];
  for (let i = 0; i < n; i++) {
    const off = i / (n - 1);
    const idx = Math.round(off * (u.length - 1));
    stops.push({ offset: off, color: valenceColorAt(u[idx]) });
  }
  return stops;
}
