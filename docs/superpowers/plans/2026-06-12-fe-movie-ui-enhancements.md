# 프론트엔드 영화 UI 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 온보딩 태그라인, 대시보드 그래프-우선 정렬, 상세 클라이맥스 지표/마커, 유사추천 match%·미니그래프를 추가한다(전부 FE-only).

**Architecture:** 순수 계산은 신규 `app/lib/climax.ts`(cosine·peaks·metrics)에 모으고, 컴포넌트(`ClimaxGraph`/`MiniGraph`)에 prop을 더해 재사용한다. `DetailOverlay`가 이미 fetch하는 `movie_vectors` 벡터로 지표·유사도를 클라이언트 계산한다. 신규 API/DB 없음.

**Tech Stack:** Next.js 16, React, TypeScript. (FE 테스트 러너 없음 — 검증은 `npm run lint` + `npm run build` 타입체크 + 배포 후 수동.)

**Spec:** `docs/superpowers/specs/2026-06-12-fe-movie-ui-enhancements-design.md`

**Working dir:** `npm` 명령은 `4K_FE/`. git은 저장소 루트. 현재 브랜치 `feat/fe-movie-ui-enhancements`.

---

## File Structure

| 파일 | 변경 |
|---|---|
| `4K_FE/app/lib/climax.ts` | 신규 — 순수 함수 |
| `4K_FE/app/page.tsx` | FEATURES 제거 + 태그라인 |
| `4K_FE/app/dashboard/page.tsx` | order 절 변경 |
| `4K_FE/app/components/ClimaxGraph.tsx` | `markers` prop |
| `4K_FE/app/components/MiniGraph.tsx` | `reference` prop |
| `4K_FE/app/components/DetailOverlay.tsx` | 지표·범례·코사인 재랭크·match%·MiniGraph |

> **검증 공통:** FE는 jest/vitest가 없음. 각 태스크는 `npx eslint <파일>`(에러 없음) + 마지막 Task에서 `npm run build`(타입체크 통과)로 검증. `climax.ts`는 워크드 예시로 로직 확인.

---

## Task 1: climax.ts — 순수 계산 함수

**Files:**
- Create: `4K_FE/app/lib/climax.ts`

- [ ] **Step 1: 구현**

`4K_FE/app/lib/climax.ts`:

```typescript
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
```

- [ ] **Step 2: 로직 워크드-검증** (lint + 예시 대조)

Run: `cd 4K_FE && npx eslint app/lib/climax.ts && echo "lint ok"`
Expected: `lint ok`

다음 예시가 코드상 성립하는지 눈으로 확인(또는 임시 `node`로):
- `cosineSimilarity([1,2,3],[2,4,6])` → `1`
- `climaxMetrics([10,50,30,92,40])` → `intensity 9.2`, `peakPositionPct 75`(argmax idx3/4), `peakCount 2`(50,92가 임계 초과 국소최대)
- `topPeaks([10,50,30,92,40],3)` → 좌→우 `[{index:1,...,label:"전반부 절정"},{index:3,valuePct:100,label:"중반 최고조"}]` (92가 최고 → 최고조)

- [ ] **Step 3: Commit**

```bash
git add 4K_FE/app/lib/climax.ts
git commit -m "feat(fe): climax.ts 순수 계산 함수(cosine/peaks/metrics)"
```

---

## Task 2: 온보딩 태그라인 (page.tsx)

**Files:**
- Modify: `4K_FE/app/page.tsx`

- [ ] **Step 1: FEATURES 배열 제거**

`4K_FE/app/page.tsx`의 `const FEATURES = [ ... ];` 블록 전체(9~71행)를 삭제.

- [ ] **Step 2: 3카드 그리드 → 태그라인 교체**

`{/* Feature cards */}` 주석과 `<div className="feature-grid"> ... </div>` 블록 전체(172~212행)를 아래로 교체:

```tsx
        {/* 서비스 태그라인 */}
        <p
          style={{
            fontSize: 'clamp(18px, 4vw, 26px)',
            fontWeight: 600,
            lineHeight: 1.5,
            color: 'rgba(255,255,255,0.82)',
            margin: '0 auto 52px',
            maxWidth: 520,
            letterSpacing: '-0.01em',
          }}
        >
          한 편의 감정을 데이터로 그리다
        </p>
```

- [ ] **Step 3: 검증**

Run: `cd 4K_FE && npx eslint app/page.tsx && echo "lint ok"`
Expected: `lint ok` (사용 안 하는 import 없는지 확인 — FEATURES만 제거됐고 BackgroundThread/useRouter 등은 유지)

- [ ] **Step 4: Commit**

```bash
git add 4K_FE/app/page.tsx
git commit -m "feat(fe): 온보딩 3카드 제거 + 태그라인"
```

---

## Task 3: 대시보드 그래프-우선 정렬 (dashboard/page.tsx)

**Files:**
- Modify: `4K_FE/app/dashboard/page.tsx`

- [ ] **Step 1: has_vector가 정렬 가능한 실제 컬럼인지 확인**

Run:
```bash
curl -s "https://data.peakly.art/rest/v1/movies?select=tmdb_id,has_vector&order=has_vector.desc,release_year.desc&limit=2" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzc4NTYyOTc3LCJleHAiOjIwOTM5MjI5Nzd9.QqZEZi5iPoq576IOc_Q1lLyk871_KbsIihBGyeFqm6M"
```
Expected: 2행 JSON(에러 아님) → `has_vector` 정렬 가능 확인. 에러(`column ... does not exist` 등)면 중단하고 보고.

- [ ] **Step 2: order 절 변경**

`4K_FE/app/dashboard/page.tsx`의 `fetchMovies` 내 URL 라인:
```tsx
    let url = `${SUPABASE_URL}/rest/v1/movies?select=*&limit=${PAGE_SIZE}&offset=${offset}&order=release_year.desc,id.desc`;
```
을:
```tsx
    let url = `${SUPABASE_URL}/rest/v1/movies?select=*&limit=${PAGE_SIZE}&offset=${offset}&order=has_vector.desc,release_year.desc,id.desc`;
```

- [ ] **Step 3: 검증**

Run: `cd 4K_FE && npx eslint app/dashboard/page.tsx && echo "lint ok"`
Expected: `lint ok`

- [ ] **Step 4: Commit**

```bash
git add 4K_FE/app/dashboard/page.tsx
git commit -m "feat(fe): 대시보드 정렬 그래프보유 우선(has_vector desc)"
```

---

## Task 4: ClimaxGraph 피크 마커 prop

**Files:**
- Modify: `4K_FE/app/components/ClimaxGraph.tsx`

- [ ] **Step 1: props 타입 + 마커 렌더 추가**

`ClimaxGraphProps`를 교체:
```tsx
interface ClimaxGraphProps {
  data: number[];
  height?: number;
  markers?: { index: number; label: string }[];
}
```
함수 시그니처:
```tsx
export default function ClimaxGraph({ data, height = 160, markers = [] }: ClimaxGraphProps) {
```
컴포넌트 return의 닫는 `</div>`(시작/결말 레이블 div 다음, 최상위 div 닫기 직전)에 마커 오버레이 추가 — `{/* 시작 / 결말 레이블 */}` div **다음**에 삽입:
```tsx
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
```

- [ ] **Step 2: 검증**

Run: `cd 4K_FE && npx eslint app/components/ClimaxGraph.tsx && echo "lint ok"`
Expected: `lint ok`

- [ ] **Step 3: Commit**

```bash
git add 4K_FE/app/components/ClimaxGraph.tsx
git commit -m "feat(fe): ClimaxGraph 피크 마커 prop"
```

---

## Task 5: MiniGraph reference(점선) prop

**Files:**
- Modify: `4K_FE/app/components/MiniGraph.tsx`

- [ ] **Step 1: props + reference 곡선 렌더**

`MiniGraphProps`를 교체:
```tsx
interface MiniGraphProps {
  data: number[];
  color?: string;
  height?: number;
  reference?: number[];   // 비교용 점선 곡선(현재 영화)
}
```
함수 시그니처:
```tsx
export default function MiniGraph({ data, color = 'var(--accent)', height = 40, reference }: MiniGraphProps) {
```
`d` 계산 다음(= `return (` 직전)에 reference 경로 계산 추가:
```tsx
  // reference 곡선 경로(있을 때만)
  let refD = '';
  if (reference && reference.length > 1) {
    const rpts = reference.map((v, i) => [padX + (i / (reference.length - 1)) * innerW, 2 + innerH - (v / 100) * innerH]);
    refD = `M${rpts[0][0]},${rpts[0][1]}`;
    for (let i = 0; i < rpts.length - 1; i++) {
      const cpx = (rpts[i][0] + rpts[i + 1][0]) / 2;
      refD += ` C${cpx},${rpts[i][1]} ${cpx},${rpts[i + 1][1]} ${rpts[i + 1][0]},${rpts[i + 1][1]}`;
    }
  }
```
SVG 내부, 채움 `<path>` **앞**에 reference 점선 추가:
```tsx
      {refD && (
        <path d={refD} fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="1.2"
              strokeDasharray="3 3" strokeLinecap="round" />
      )}
```

- [ ] **Step 2: 검증**

Run: `cd 4K_FE && npx eslint app/components/MiniGraph.tsx && echo "lint ok"`
Expected: `lint ok`

- [ ] **Step 3: Commit**

```bash
git add 4K_FE/app/components/MiniGraph.tsx
git commit -m "feat(fe): MiniGraph reference 점선 오버레이 prop"
```

---

## Task 6: 상세 지표 카드 + 피크 범례 (DetailOverlay)

**Files:**
- Modify: `4K_FE/app/components/DetailOverlay.tsx`

- [ ] **Step 1: import + 계산값**

import 라인(5행) 교체로 climax 함수 추가:
```tsx
import { Movie, posterUrl, genreList, castList, fetchVector, fetchPreferredMovies, fetchMovieVectors } from '@/app/lib/data';
import { cosineSimilarity, climaxMetrics, topPeaks } from '@/app/lib/climax';
```
컴포넌트 본문 상단(`const cast = castList(movie.actors);` 다음)에 추가:
```tsx
  const metrics = vector ? climaxMetrics(vector) : null;
  const peaks = vector ? topPeaks(vector, 3) : [];
```
(주의: `vector` state는 아래에서 선언되므로, 이 두 줄은 `const [similarLoading, setSimilarLoading] = useState(true);` **다음**에 위치시킬 것.)

- [ ] **Step 2: CLIMAX GRAPH 섹션에 지표 카드 + 마커 + 범례**

`{/* 클라이맥스(피크) 그래프 ... */}` `<section>` 블록 전체(136~154행)를 아래로 교체:
```tsx
          {/* 클라이맥스 지표 + 그래프 + 피크 범례 */}
          <section style={{ marginTop: 40 }}>
            <h3 style={sectionLabel}>CLIMAX GRAPH</h3>

            {metrics && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 12 }}>
                {[
                  { k: '클라이맥스 강도', v: `${metrics.intensity}`, suf: ' / 10' },
                  { k: '절정 위치', v: `${metrics.peakPositionPct}%`, suf: ' 지점' },
                  { k: '긴장 피크', v: `${metrics.peakCount}`, suf: '회' },
                ].map((c) => (
                  <div key={c.k} style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '16px 18px' }}>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.12em', fontWeight: 700 }}>{c.k}</div>
                    <div style={{ marginTop: 8, fontFamily: 'var(--font-playfair), serif', fontWeight: 800, fontSize: 30, color: 'var(--fg)' }}>
                      {c.v}<span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.4)' }}>{c.suf}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{
              marginTop: 12, height: 300, borderRadius: 8,
              background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)',
              overflow: 'hidden',
              display: vectorLoading || !vector ? 'grid' : 'block',
              placeItems: 'center',
            }}>
              {vectorLoading ? (
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em' }}>로딩 중...</span>
              ) : vector ? (
                <ClimaxGraph data={vector} height={300} markers={peaks.map((p, i) => ({ index: p.index, label: String(i + 1) }))} />
              ) : (
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em' }}>준비중</span>
              )}
            </div>

            {vector && peaks.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginTop: 14 }}>
                {peaks.map((p, i) => (
                  <div key={p.index} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--accent)', color: '#0a0a0f', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 800 }}>{i + 1}</span>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{p.label} · 강도 {p.valuePct}%</span>
                  </div>
                ))}
              </div>
            )}
          </section>
```

- [ ] **Step 3: 검증**

Run: `cd 4K_FE && npx eslint app/components/DetailOverlay.tsx && echo "lint ok"`
Expected: `lint ok` (이 시점엔 cosineSimilarity 미사용 경고가 날 수 있음 — Task 7에서 사용하므로, Task 7과 함께 최종 lint. 지금은 import만 추가됐다면 unused 경고 가능 → Step 1에서 cosineSimilarity import는 Task 7에서 실제 사용되니 함께 둠. 경고만 있고 에러 아니면 진행.)

- [ ] **Step 4: Commit**

```bash
git add 4K_FE/app/components/DetailOverlay.tsx
git commit -m "feat(fe): 상세 클라이맥스 지표 카드 + 피크 마커/범례"
```

---

## Task 7: 유사 추천 코사인 재랭크 + match% + 미니그래프 (DetailOverlay)

**Files:**
- Modify: `4K_FE/app/components/DetailOverlay.tsx`

- [ ] **Step 1: dtwDistance 제거 + MiniGraph import**

`dtwDistance` 함수 정의 블록(7~24행) 전체 삭제. import 영역에 추가:
```tsx
import MiniGraph from '@/app/components/MiniGraph';
```

- [ ] **Step 2: similar state 타입 변경**

```tsx
  const [similar, setSimilar] = useState<Movie[]>([]);
```
을:
```tsx
  const [similar, setSimilar] = useState<{ movie: Movie; vector: number[]; matchPct: number }[]>([]);
```

- [ ] **Step 3: useEffect 재랭크를 코사인으로**

`// 후보 벡터 일괄 fetch → DTW 정렬 ...` 부터 `setSimilar(ranked);` 까지(82~93행 영역)를 아래로 교체:
```tsx
      // 후보 벡터 일괄 fetch → 코사인 유사도 내림차순 상위 4
      const vecMap = await fetchMovieVectors(candidates.map((m: Movie) => m.tmdb_id));
      const ranked = candidates
        .map((m: Movie) => {
          const cv = vecMap.get(m.tmdb_id);
          return cv ? { movie: m, vector: cv, sim: cosineSimilarity(queryVec, cv) } : null;
        })
        .filter((x): x is { movie: Movie; vector: number[]; sim: number } => x !== null)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 4)
        .map((x) => ({ movie: x.movie, vector: x.vector, matchPct: Math.round(x.sim * 100) }));

      setSimilar(ranked);
```

- [ ] **Step 4: 유사 카드 렌더를 match% + MiniGraph 레이아웃으로**

`similar.map((m) => { ... })` 블록(173~207행 영역, `const simImg`부터 카드 `</button>`까지)을 아래로 교체:
```tsx
                : similar.map(({ movie: m, vector: simVec, matchPct }) => {
                const simImg = posterUrl(m.poster_path);
                const simGenres = genreList(m.genre).slice(0, 2);
                return (
                  <button
                    key={m.tmdb_id}
                    onClick={() => onSelectMovie(m)}
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 10, padding: 12,
                      cursor: 'pointer', color: 'inherit', fontFamily: 'inherit', textAlign: 'left',
                      display: 'flex', gap: 14, alignItems: 'center',
                      transition: 'background 0.2s, border-color 0.2s',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.14)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.03)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.08)'; }}
                  >
                    {/* MATCH % */}
                    <div style={{ flexShrink: 0, width: 52, textAlign: 'center' }}>
                      <div style={{ fontFamily: 'var(--font-playfair), serif', fontWeight: 800, fontSize: 24, color: 'var(--accent)', lineHeight: 1 }}>{matchPct}</div>
                      <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.4)', marginTop: 3 }}>MATCH %</div>
                    </div>
                    {/* 포스터 */}
                    <div style={{ width: 44, flexShrink: 0, aspectRatio: '2/3', borderRadius: 6, overflow: 'hidden', background: '#111218', position: 'relative' }}>
                      {simImg ? (
                        <img src={simImg} alt={m.title} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}><span style={{ fontSize: 16 }}>🎬</span></div>
                      )}
                    </div>
                    {/* 제목·메타 */}
                    <div style={{ flexShrink: 0, width: 150, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 }}>{m.title}</div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 4 }}>
                        {m.release_year}{simGenres.length ? ` · ${simGenres.join(' · ')}` : ''}
                      </div>
                    </div>
                    {/* 미니그래프(해당 영화 실선 + 현재 영화 점선) */}
                    <div style={{ flex: 1, minWidth: 80, height: 48 }}>
                      <MiniGraph data={simVec} reference={vector ?? undefined} height={48} />
                    </div>
                  </button>
                );
              })}
```

- [ ] **Step 5: similar-grid → 1열 리스트로 (CSS)**

`similar-grid`가 2×2 그리드라면 이미지(세로 리스트)와 맞추기 위해 인라인 스타일로 교체. `<div className="similar-grid">`를:
```tsx
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
```
로 교체하고, 대응하는 닫는 `</div>  {/* similar-grid */}`는 그대로 둠(주석만 무의미해짐, 유지 가능). 로딩 스켈레톤 카드의 `height: 88`은 `height: 72`로 낮춰도 무방(선택).

- [ ] **Step 6: 최종 lint + 빌드**

Run:
```bash
cd 4K_FE && npx eslint app/components/DetailOverlay.tsx && echo "eslint ok" && npm run build 2>&1 | tail -15
```
Expected: eslint 에러 없음 + `npm run build` 성공(타입체크 통과, 라우트 컴파일). dtwDistance 제거로 unused 경고도 사라짐.

- [ ] **Step 7: Commit**

```bash
git add 4K_FE/app/components/DetailOverlay.tsx
git commit -m "feat(fe): 유사추천 코사인 match% + 점선 비교 미니그래프"
```

---

## 배포 후 수동 확인 (코드 외 — 사용자)

1. main 병합 + push → FE CI 빌드·배포.
2. 온보딩: 3카드 사라지고 "한 편의 감정을 데이터로 그리다" 표시.
3. 대시보드: 그래프 보유 영화가 상단, 그 안에서 신작순.
4. 상세: 지표 카드 3개 + 곡선 위 ①②③ 마커 + 범례.
5. 유사 추천: MATCH % 내림차순 + 미니곡선(점선=현재 영화 비교).

---

## Self-Review 결과

**Spec coverage:** §2 결정 — 태그라인→Task2; 정렬→Task3; 지표/마커/범례→Task1(climaxMetrics/topPeaks)·4(ClimaxGraph)·6(DetailOverlay); match%/미니그래프→Task1(cosine)·5(MiniGraph)·7(DetailOverlay). §4 컴포넌트 전부 매핑. §6 리스크(has_vector 컬럼→Task3 Step1 확인, 빈 벡터→climax.ts 방어). 누락 없음.

**Placeholder scan:** 코드/명령 구체화. FE 테스트 러너 부재로 검증은 eslint+build+수동(명시). climax.ts는 워크드 예시로 확인.

**Type consistency:** `climaxMetrics`→{intensity,peakPositionPct,peakCount}, `topPeaks`→{index,valuePct,label}가 Task6에서 동일 사용. `cosineSimilarity(number[],number[])`가 Task7에서 사용. similar state 타입 `{movie,vector,matchPct}[]`가 Task3·7 일치. ClimaxGraph `markers:{index,label}[]`·MiniGraph `reference:number[]` prop이 Task4·5 정의와 Task6·7 호출에서 일치. `vector` state(`number[]|null`)를 MiniGraph reference에 `?? undefined`로 전달(타입 정합).
```