// movie_vectors 클라이맥스 곡선(0~100)에서 파생 지표/피크/유사도 계산 (순수 함수)

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

function meanStd(v: number[]): [number, number] {
  const n = v.length;
  const mean = v.reduce((s, x) => s + x, 0) / n;
  const variance = v.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  return [mean, Math.sqrt(variance)];
}

// 국소 최대(이웃보다 큼) & 값 > 평균 + k·표준편차 인 인덱스
export function findPeaks(v: number[], k = 0.5): number[] {
  if (v.length < 3) return [];
  const [mean, std] = meanStd(v);
  const threshold = mean + k * std;
  const peaks: number[] = [];
  for (let i = 1; i < v.length - 1; i++) {
    if (v[i] > v[i - 1] && v[i] >= v[i + 1] && v[i] > threshold) peaks.push(i);
  }
  return peaks;
}

export interface ClimaxMetrics {
  intensity: number;        // 0~10 (소수 1자리)
  peakPositionPct: number;  // 0~100
  peakCount: number;
}

export function climaxMetrics(v: number[]): ClimaxMetrics {
  if (v.length === 0) return { intensity: 0, peakPositionPct: 0, peakCount: 0 };
  let max = v[0], argmax = 0;
  for (let i = 1; i < v.length; i++) if (v[i] > max) { max = v[i]; argmax = i; }
  return {
    intensity: Math.round((max / 10) * 10) / 10,
    peakPositionPct: Math.round((argmax / Math.max(1, v.length - 1)) * 100),
    peakCount: findPeaks(v).length,
  };
}

export interface TopPeak {
  index: number;
  valuePct: number;  // 봉우리값 / 최고점 × 100
  label: string;     // "전반부 피크" 등
}

// 높이 상위 n개 봉우리 → 좌→우 순서로 반환(라벨 서술어는 높이 순위로 결정)
export function topPeaks(v: number[], n = 3): TopPeak[] {
  if (v.length === 0) return [];
  const max = Math.max(...v);
  if (max === 0) return [];
  let cand = findPeaks(v);
  if (cand.length === 0) cand = [v.indexOf(max)];
  const byHeight = [...cand].sort((a, b) => v[b] - v[a]).slice(0, n);
  const ranked = byHeight.map((idx, rank) => ({ idx, rank }));  // rank 0 = 최고
  ranked.sort((a, b) => a.idx - b.idx);                          // 좌→우
  const L = v.length;
  return ranked.map(({ idx, rank }) => {
    const pos = idx / Math.max(1, L - 1);
    const prefix = pos < 0.33 ? '전반부' : pos < 0.66 ? '중반' : '후반';
    const desc = rank === 0 ? '최고조' : rank === 1 ? '절정' : '피크';
    return { index: idx, valuePct: Math.round((v[idx] / max) * 100), label: `${prefix} ${desc}` };
  });
}
