// movie_vectors 클라이맥스 곡선(z-score)에서 파생 지표/피크/유사도 계산 (순수 함수)

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// 배열을 z-score로 정규화 (std=0이면 1로 대체 → 평탄 벡터 안전)
function zscore(v: number[]): number[] {
  const n = v.length;
  if (n === 0) return [];
  const mean = v.reduce((s, x) => s + x, 0) / n;
  const variance = v.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance) || 1;
  return v.map((x) => (x - mean) / std);
}

// 표시용 0~100 스케일: z를 (z+3)/6×100로 매핑(±3σ를 전체 높이에 대응), clamp
export function toDisplayScale(v: number[]): number[] {
  const z = zscore(v);
  return z.map((x) => Math.min(100, Math.max(0, ((x + 3) / 6) * 100)));
}

// z>k 이고 ±win 윈도에서 최댓값인 분리된 봉우리 인덱스.
// 동률 평탄 구간은 가장 앞 인덱스만 채택(좌측에 같은 값 있으면 탈락).
function countPeaks(v: number[]): number[] {
  const n = v.length;
  if (n < 3) return [];
  const z = zscore(v);
  const k = 1.0;
  const win = Math.max(3, Math.round(n * 0.04));
  const peaks: number[] = [];
  for (let i = 0; i < n; i++) {
    if (z[i] <= k) continue;
    let isPeak = true;
    for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j++) {
      if (j === i) continue;
      if (z[j] > z[i]) { isPeak = false; break; }           // 더 큰 이웃 있음
      if (z[j] === z[i] && j < i) { isPeak = false; break; } // 동률은 앞쪽만
    }
    if (isPeak) peaks.push(i);
  }
  return peaks;
}

export interface ClimaxMetrics {
  intensity: number;        // 0~10 (소수 1자리)
  peakPositionPct: number;  // 0~100
  peakCount: number;
}

export function climaxMetrics(v: number[]): ClimaxMetrics {
  if (v.length < 3) return { intensity: 0, peakPositionPct: 0, peakCount: 0 };
  const z = zscore(v);
  let maxZ = z[0], argmax = 0;
  for (let i = 1; i < z.length; i++) if (z[i] > maxZ) { maxZ = z[i]; argmax = i; }
  const intensity = Math.min(10, Math.max(0, ((maxZ - 1.0) / 2.5) * 10));
  return {
    intensity: Math.round(intensity * 10) / 10,
    peakPositionPct: Math.round((argmax / (z.length - 1)) * 100),
    peakCount: countPeaks(v).length,
  };
}

export interface TopPeak {
  index: number;
  valuePct: number;  // 고정 display 스케일(0~100) 상의 봉우리 높이
  label: string;     // "중반 최고조" 등
}

// 높이(z) 상위 n개 봉우리 → 좌→우 순서. 서술어는 높이 순위로 결정.
export function topPeaks(v: number[], n = 3): TopPeak[] {
  if (v.length === 0) return [];
  const z = zscore(v);
  const display = toDisplayScale(v);
  let cand = countPeaks(v);
  if (cand.length === 0) {
    let argmax = 0;
    for (let i = 1; i < z.length; i++) if (z[i] > z[argmax]) argmax = i;
    cand = [argmax];
  }
  const byHeight = [...cand].sort((a, b) => z[b] - z[a]).slice(0, n);
  const ranked = byHeight.map((idx, rank) => ({ idx, rank }));  // rank 0 = 최고
  ranked.sort((a, b) => a.idx - b.idx);                         // 좌→우
  const L = v.length;
  return ranked.map(({ idx, rank }) => {
    const pos = idx / Math.max(1, L - 1);
    const prefix = pos < 0.33 ? '전반부' : pos < 0.66 ? '중반' : '후반';
    const desc = rank === 0 ? '최고조' : rank === 1 ? '절정' : '피크';
    return { index: idx, valuePct: Math.round(display[idx]), label: `${prefix} ${desc}` };
  });
}

// 곡선 형태를 한 줄 한국어로 요약 (정점 위치 중심 + 상승 패턴·피크 수)
export function climaxDescriptor(v: number[]): string {
  if (v.length < 3) return '';
  const m = climaxMetrics(v);
  const ds = toDisplayScale(v);
  const n = ds.length;
  const third = Math.max(1, Math.floor(n / 3));
  const avg = (a: number, b: number) => {
    let s = 0;
    for (let i = a; i < b; i++) s += ds[i];
    return s / (b - a);
  };
  const early = avg(0, third);
  const late = avg(n - third, n);
  const rise = late - early;
  const pos = m.peakPositionPct;

  if (pos >= 66) {
    if (rise > 12 && early < 45) return '잔잔하다 마지막에 폭발';
    if (rise > 8) return '후반으로 갈수록 고조되는 곡선';
    return '후반 집중형 절정';
  }
  if (pos < 33) {
    if (early > late + 10) return '초반 폭발 후 잦아드는 곡선';
    return '초반부터 달아오르는 곡선';
  }
  if (m.peakCount >= 7) return '쉴 틈 없는 다중 클라이맥스';
  return '중반 정점의 산형 곡선';
}
