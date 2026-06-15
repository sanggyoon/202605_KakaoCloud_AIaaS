# FE valence 색상 이중인코딩 + 가중 유사도 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 클라이맥스 곡선에 arousal=높이 + valence=색(팔레트 A, 영화별 정규화)을 동시 표현하고, 유사 추천을 0.5·arousal + 0.5·valence 코사인으로 재랭킹한다.

**Architecture:** 색/정규화는 신규 순수 모듈 `app/lib/color.ts`, 중심화는 `app/lib/climax.ts`. `data.ts`가 valence도 fetch(`*Pair`), `ClimaxGraph`/`MiniGraph`가 valence 그라데이션 stroke, `DetailOverlay`가 두 축을 엮어 렌더·재랭킹. BE/DB 변경 없음.

**Tech Stack:** Next.js 16 client components, TypeScript, SVG linearGradient. 테스트 러너 없음 → 순수 모듈은 `npx tsx` 스폿체크, 컴포넌트는 `npm run build` + 수동.

**선행 스펙:** `docs/superpowers/specs/2026-06-15-fe-valence-color-similarity-design.md`

**작업 경로:** `/Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE` (git 루트=`/Users/sanggyoon/Documents/KakaoCloud_Project`). 커밋 메시지 끝:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## 사전 메모

- 벡터: `roberta-va-v1::arousal`(z-score, 음수 가능) = 높이, `roberta-va-v1::valence`(raw 0~1) = 색. 둘 다 200점 동일 그리드 → 인덱스 i로 짝.
- 팔레트 A RGB: teal `[45,212,191]` → purple `[123,97,255]` → pink `[255,110,199]`. CSS hex: `#2dd4bf / #7b61ff / #ff6ec7`.
- 색 매핑 = 영화별 정규화(valence min→max). 유사도 valence 항은 raw라 **평균 중심화 후** 코사인.
- PostgREST 다중 버전 조회: `vector_version=in.(roberta-va-v1::arousal,roberta-va-v1::valence)` (값에 콤마/괄호 없어 따옴표 불필요, `::`는 인코딩 없이 동작 — 기존 `eq.roberta-va-v1::arousal`로 검증됨).
- 빌드: `cd 4K_FE && npm run build 2>&1 | grep -E "Compiled|Failed|Error"` → `✓ Compiled successfully`.

---

## Task 1: `color.ts` — 팔레트·정규화·그라데이션 (순수)

**Files:** Create `4K_FE/app/lib/color.ts` · Verify `/tmp/verify-color.mts`

- [ ] **Step 1: 검증 스크립트 작성**

`/tmp/verify-color.mts`:
```ts
import assert from 'node:assert';
import { valenceToUnit, valenceColorAt, valenceGradientStops } from '/Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE/app/lib/color.ts';

// 영화별 정규화: min→0, max→1
const u = valenceToUnit([0.2, 0.45, 0.1, 0.3]);
assert.strictEqual(Math.min(...u), 0);
assert.strictEqual(Math.max(...u), 1);
assert.ok(Math.abs(u[2] - 0) < 1e-9);          // 0.1 = min → 0
assert.ok(Math.abs(u[1] - 1) < 1e-9);          // 0.45 = max → 1

// 색: 0=teal, 0.5=purple, 1=pink, clamp
assert.strictEqual(valenceColorAt(0), '#2dd4bf');
assert.strictEqual(valenceColorAt(0.5), '#7b61ff');
assert.strictEqual(valenceColorAt(1), '#ff6ec7');
assert.strictEqual(valenceColorAt(-5), '#2dd4bf');
assert.strictEqual(valenceColorAt(9), '#ff6ec7');

// 그라데이션 stop: 빈/단일 → [], 정상 → n개 offset 0~1
assert.deepStrictEqual(valenceGradientStops([]), []);
assert.deepStrictEqual(valenceGradientStops([0.5]), []);
const stops = valenceGradientStops([0.1, 0.5, 0.9], 10);
assert.strictEqual(stops.length, 10);
assert.strictEqual(stops[0].offset, 0);
assert.ok(Math.abs(stops[9].offset - 1) < 1e-9);
assert.ok(/^#[0-9a-f]{6}$/.test(stops[0].color));
console.log('ALL COLOR CHECKS PASSED');
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE && npx --yes tsx /tmp/verify-color.mts`
Expected: FAIL (모듈/함수 없음)

- [ ] **Step 3: 구현**

`4K_FE/app/lib/color.ts`:
```ts
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
```

- [ ] **Step 4: 통과 확인**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE && npx --yes tsx /tmp/verify-color.mts`
Expected: `ALL COLOR CHECKS PASSED`

- [ ] **Step 5: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/lib/color.ts
git commit -m "feat(valence): color.ts — 팔레트 A·영화별 정규화·그라데이션 stop

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `climax.ts` — meanCenter 추가

**Files:** Modify `4K_FE/app/lib/climax.ts` · Verify `/tmp/verify-center.mts`

- [ ] **Step 1: 검증 스크립트**

`/tmp/verify-center.mts`:
```ts
import assert from 'node:assert';
import { meanCenter, cosineSimilarity } from '/Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE/app/lib/climax.ts';

const c = meanCenter([1, 2, 3]);
assert.ok(Math.abs(c.reduce((s, x) => s + x, 0)) < 1e-9);  // 평균 0
assert.deepStrictEqual(meanCenter([]), []);

// raw 양수 벡터는 코사인이 1에 몰리지만, 중심화하면 변별이 생김
const a = [0.2, 0.5, 0.3], b = [0.5, 0.2, 0.3];
assert.ok(cosineSimilarity(a, b) > 0.8);                              // raw: 높게 뭉침
assert.ok(cosineSimilarity(meanCenter(a), meanCenter(b)) < cosineSimilarity(a, b)); // 중심화: 변별↑
console.log('ALL CENTER CHECKS PASSED');
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE && npx --yes tsx /tmp/verify-center.mts`
Expected: FAIL (`meanCenter` 없음)

- [ ] **Step 3: 구현 — `climax.ts` 끝에 추가**

`4K_FE/app/lib/climax.ts` 파일 맨 끝에 추가:
```ts

// 평균 중심화 — raw(전부 양수) 벡터의 코사인 변별력 확보(=피어슨 상관)
export function meanCenter(v: number[]): number[] {
  if (v.length === 0) return [];
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  return v.map((x) => x - mean);
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE && npx --yes tsx /tmp/verify-center.mts`
Expected: `ALL CENTER CHECKS PASSED`

- [ ] **Step 5: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/lib/climax.ts
git commit -m "feat(valence): climax.ts meanCenter (valence 코사인용 중심화)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `data.ts` — arousal+valence 쌍 fetch

**Files:** Modify `4K_FE/app/lib/data.ts`

- [ ] **Step 1: 두 함수 추가 (`fetchMovieVectors` 정의 바로 아래에 삽입)**

`4K_FE/app/lib/data.ts`의 `fetchVector` 함수 정의 아래(파일 내 vector 관련 함수 묶음 끝)에 추가:
```ts
// arousal+valence 두 축을 함께 fetch (상세용)
export async function fetchVectorPair(
  tmdbId: number,
): Promise<{ arousal: number[]; valence: number[] } | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/movie_vectors?tmdb_id=eq.${tmdbId}&vector_version=in.(roberta-va-v1::arousal,roberta-va-v1::valence)&select=vector_version,vector`,
      { headers: { apikey: SUPABASE_ANON_KEY } },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { vector_version: string; vector: string | number[] }[];
    let arousal: number[] | null = null;
    let valence: number[] = [];
    for (const r of rows) {
      const v = Array.isArray(r.vector) ? r.vector : (JSON.parse(r.vector as string) as number[]);
      if (r.vector_version.endsWith('::arousal')) arousal = v;
      else if (r.vector_version.endsWith('::valence')) valence = v;
    }
    return arousal ? { arousal, valence } : null;
  } catch {
    return null;
  }
}

// 여러 영화의 arousal+valence 쌍 (유사 후보용). arousal 없는 영화는 제외.
export async function fetchMovieVectorPairs(
  tmdbIds: number[],
): Promise<Map<number, { arousal: number[]; valence: number[] }>> {
  const map = new Map<number, { arousal: number[]; valence: number[] }>();
  if (tmdbIds.length === 0) return map;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/movie_vectors?tmdb_id=in.(${tmdbIds.join(',')})&vector_version=in.(roberta-va-v1::arousal,roberta-va-v1::valence)&select=tmdb_id,vector_version,vector`,
      { headers: { apikey: SUPABASE_ANON_KEY } },
    );
    if (!res.ok) return map;
    const rows = (await res.json()) as { tmdb_id: number; vector_version: string; vector: string | number[] }[];
    for (const r of rows) {
      const v = Array.isArray(r.vector) ? r.vector : (JSON.parse(r.vector as string) as number[]);
      const cur = map.get(r.tmdb_id) ?? { arousal: [], valence: [] };
      if (r.vector_version.endsWith('::arousal')) cur.arousal = v;
      else if (r.vector_version.endsWith('::valence')) cur.valence = v;
      map.set(r.tmdb_id, cur);
    }
    for (const [k, val] of map) if (val.arousal.length === 0) map.delete(k);
    return map;
  } catch {
    return map;
  }
}
```

- [ ] **Step 2: 빌드(타입체크)**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE && npm run build 2>&1 | grep -E "Compiled|Failed|Error"`
Expected: `✓ Compiled successfully`

- [ ] **Step 3: 라이브 응답 확인 (in.() + :: 동작)**

Run:
```bash
curl -s "https://data.peakly.art/rest/v1/movie_vectors?tmdb_id=eq.176&vector_version=in.(roberta-va-v1::arousal,roberta-va-v1::valence)&select=vector_version" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzc4NTYyOTc3LCJleHAiOjIwOTM5MjI5Nzd9.QqZEZi5iPoq576IOc_Q1lLyk871_KbsIihBGyeFqm6M"
```
Expected: 두 행(`::arousal`, `::valence`). 만약 빈 배열/400이면 in-list 값을 따옴표로 감싸 인코딩(`in.("roberta-va-v1::arousal","roberta-va-v1::valence")`)으로 바꿔 재확인.

- [ ] **Step 4: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/lib/data.ts
git commit -m "feat(valence): data.ts fetchVectorPair/fetchMovieVectorPairs (arousal+valence)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `ClimaxGraph.tsx` — valence 그라데이션 + 호버 분위기 (전체 교체)

**Files:** Modify(전체 교체) `4K_FE/app/components/ClimaxGraph.tsx`

- [ ] **Step 1: 파일 전체를 다음으로 교체**

```tsx
'use client';

import { useRef, useState } from 'react';
import { toDisplayScale } from '@/app/lib/climax';
import { valenceGradientStops, valenceToUnit, valenceColorAt } from '@/app/lib/color';

// arousal=높이, valence=색(있을 때). 호버 시 십자선 + 진행도/피크/분위기 툴팁.
interface ClimaxGraphProps {
  data: number[];        // arousal
  valence?: number[];    // valence (색)
  height?: number;
}

export default function ClimaxGraph({ data, valence, height = 380 }: ClimaxGraphProps) {
  const W = 600;
  const H = height;
  const padX = 8;
  const padY = 64;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const toY = (val: number) => padY + innerH - ((val - min) / range) * innerH;
  const toX = (i: number) => padX + (i / (data.length - 1)) * innerW;

  const pts = data.map((val, i) => [toX(i), toY(val)]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const cpx = (pts[i][0] + pts[i + 1][0]) / 2;
    d += ` C${cpx},${pts[i][1]} ${cpx},${pts[i + 1][1]} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  const fillD = `${d} L${padX + innerW},${H} L${padX},${H} Z`;

  const stops = valence ? valenceGradientStops(valence) : [];
  const vUnit = valence ? valenceToUnit(valence) : [];
  const stroke = stops.length ? 'url(#cgValence)' : 'var(--accent)';

  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover(Math.round(fx * (data.length - 1)));
  };

  const hx = hover !== null ? (toX(hover) / W) * 100 : 0;
  const hy = hover !== null ? (toY(data[hover]) / H) * 100 : 0;
  const progress = hover !== null ? Math.round((hover / (data.length - 1)) * 100) : 0;
  const peakPct = hover !== null ? Math.round(toDisplayScale(data)[hover]) : 0;
  const moodU = hover !== null && vUnit.length ? vUnit[hover] : null;
  const moodColor = moodU !== null ? valenceColorAt(moodU) : '#fff';
  const moodLabel = moodU === null ? '' : moodU < 0.33 ? '어두움' : moodU < 0.66 ? '중립' : '밝음';
  const tipLeft = Math.min(86, Math.max(14, hx));
  const tipBelow = hy < 16;

  return (
    <div
      ref={containerRef}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
      style={{ position: 'relative', width: '100%', height, cursor: 'crosshair' }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: '100%', display: 'block', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id="cgFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.015" />
          </linearGradient>
          {stops.length > 0 && (
            <linearGradient id="cgValence" x1="0" y1="0" x2="1" y2="0">
              {stops.map((s, i) => (
                <stop key={i} offset={`${(s.offset * 100).toFixed(1)}%`} stopColor={s.color} />
              ))}
            </linearGradient>
          )}
          <filter id="cgGlow" x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path d={fillD} fill="url(#cgFill)" />
        <path
          d={d}
          fill="none"
          stroke={stroke}
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#cgGlow)"
        />
      </svg>

      {hover !== null && (
        <>
          <div style={{ position: 'absolute', left: `${hx}%`, top: 0, bottom: 0, width: 1, background: 'rgba(123,97,255,0.45)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', top: `${hy}%`, left: 0, right: 0, height: 1, background: 'rgba(123,97,255,0.45)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', left: `${hx}%`, top: `${hy}%`, transform: 'translate(-50%, -50%)', width: 11, height: 11, borderRadius: '50%', background: moodColor, boxShadow: `0 0 14px 4px ${moodColor}`, pointerEvents: 'none' }} />
          <div
            style={{
              position: 'absolute', left: `${tipLeft}%`, top: `${hy}%`,
              transform: tipBelow ? 'translate(-50%, 16px)' : 'translate(-50%, calc(-100% - 16px))',
              pointerEvents: 'none', whiteSpace: 'nowrap',
              background: 'rgba(15,14,22,0.92)', border: '1px solid rgba(123,97,255,0.4)',
              borderRadius: 8, padding: '8px 12px', backdropFilter: 'blur(4px)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.4)' }}>진행도</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', lineHeight: 1.2 }}>{progress}%</div>
              </div>
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--accent)' }}>피크</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--accent)', lineHeight: 1.2 }}>{peakPct}%</div>
              </div>
              {moodU !== null && (
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.4)' }}>분위기</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                    <span style={{ width: 11, height: 11, borderRadius: '50%', background: moodColor }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{moodLabel}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 빌드**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE && npm run build 2>&1 | grep -E "Compiled|Failed|Error"`
Expected: `✓ Compiled successfully`

- [ ] **Step 3: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/components/ClimaxGraph.tsx
git commit -m "feat(valence): ClimaxGraph valence 그라데이션 stroke + 호버 분위기

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `MiniGraph.tsx` — valence 그라데이션 (전체 교체, reference 제거)

**Files:** Modify(전체 교체) `4K_FE/app/components/MiniGraph.tsx`

- [ ] **Step 1: 파일 전체를 다음으로 교체**

```tsx
'use client';

import { useId } from 'react';
import { toDisplayScale } from '@/app/lib/climax';
import { valenceGradientStops } from '@/app/lib/color';

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

  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const cpx = (pts[i][0] + pts[i + 1][0]) / 2;
    d += ` C${cpx},${pts[i][1]} ${cpx},${pts[i + 1][1]} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }

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
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
```

- [ ] **Step 2: 빌드**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE && npm run build 2>&1 | grep -E "Compiled|Failed|Error"`
Expected: `✓ Compiled successfully` (만약 `reference` 미사용 관련 에러가 나면 DetailOverlay에서 reference prop 전달이 없는지 Task 6에서 정리됨 — 이 시점엔 MiniGraph만 바뀌어 reference를 안 받으므로 OK.)

- [ ] **Step 3: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/components/MiniGraph.tsx
git commit -m "feat(valence): MiniGraph valence 그라데이션 stroke (reference 제거)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: `DetailOverlay.tsx` — 쌍 fetch + 가중 재랭킹 + 색 전달 + 범례

**Files:** Modify `4K_FE/app/components/DetailOverlay.tsx`

- [ ] **Step 1: import 교체**

다음 블록을
```tsx
import {
  Movie,
  posterUrl,
  genreList,
  castList,
  fetchVector,
  fetchPreferredMovies,
  fetchMovieVectors,
} from '@/app/lib/data';
import { cosineSimilarity, climaxDescriptor } from '@/app/lib/climax';
```
로 교체:
```tsx
import {
  Movie,
  posterUrl,
  genreList,
  castList,
  fetchVectorPair,
  fetchPreferredMovies,
  fetchMovieVectorPairs,
} from '@/app/lib/data';
import { cosineSimilarity, climaxDescriptor, meanCenter } from '@/app/lib/climax';
```

- [ ] **Step 2: 상태 교체 (valence 추가, similar 타입 변경)**

다음 블록을
```tsx
  const [vector, setVector] = useState<number[] | null>(null);
  const [vectorLoading, setVectorLoading] = useState(true);
  const [similar, setSimilar] = useState<
    { movie: Movie; vector: number[]; matchPct: number }[]
  >([]);
  const [similarLoading, setSimilarLoading] = useState(true);
```
로 교체:
```tsx
  const [vector, setVector] = useState<number[] | null>(null);   // arousal(높이)
  const [valence, setValence] = useState<number[] | null>(null); // valence(색)
  const [vectorLoading, setVectorLoading] = useState(true);
  const [similar, setSimilar] = useState<
    { movie: Movie; arousal: number[]; valence: number[]; matchPct: number }[]
  >([]);
  const [similarLoading, setSimilarLoading] = useState(true);
```

- [ ] **Step 3: fetch/재랭킹 effect 교체**

`useEffect(() => { ... }, [movie.id]);` (벡터+유사 fetch) 블록 전체를 다음으로 교체:
```tsx
  useEffect(() => {
    setVector(null);
    setValence(null);
    setVectorLoading(true);
    setSimilar([]);
    setSimilarLoading(true);

    Promise.all([
      fetchVectorPair(movie.tmdb_id),
      fetchPreferredMovies([movie.tmdb_id], [], 50),
    ]).then(async ([pair, rawCandidates]) => {
      setVector(pair?.arousal ?? null);
      setValence(pair && pair.valence.length ? pair.valence : null);
      setVectorLoading(false);

      const candidates = rawCandidates.filter((m: Movie) => m.tmdb_id !== movie.tmdb_id);
      if (candidates.length === 0 || !pair) {
        setSimilar([]);
        setSimilarLoading(false);
        return;
      }

      const pairMap = await fetchMovieVectorPairs(candidates.map((m: Movie) => m.tmdb_id));
      const qArousal = pair.arousal;
      const qValenceC = pair.valence.length ? meanCenter(pair.valence) : null;

      const ranked = candidates
        .map((m: Movie) => {
          const cp = pairMap.get(m.tmdb_id);
          if (!cp) return null;
          const aSim = cosineSimilarity(qArousal, cp.arousal);
          const vSim =
            qValenceC && cp.valence.length
              ? cosineSimilarity(qValenceC, meanCenter(cp.valence))
              : aSim; // valence 없으면 arousal로 대체(가중 왜곡 방지)
          return { movie: m, arousal: cp.arousal, valence: cp.valence, sim: 0.5 * aSim + 0.5 * vSim };
        })
        .filter(
          (x): x is { movie: Movie; arousal: number[]; valence: number[]; sim: number } => x !== null,
        )
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 4)
        .map((x) => ({
          movie: x.movie,
          arousal: x.arousal,
          valence: x.valence,
          matchPct: Math.round(x.sim * 100),
        }));

      setSimilar(ranked);
      setSimilarLoading(false);
    });
  }, [movie.id]);
```

- [ ] **Step 4: ClimaxGraph에 valence 전달 + 범례 추가**

다음 줄을
```tsx
              ) : vector ? (
                <ClimaxGraph data={vector} height={380} />
              ) : (
```
로 교체:
```tsx
              ) : vector ? (
                <ClimaxGraph data={vector} valence={valence ?? undefined} height={380} />
              ) : (
```

그리고 그래프 컨테이너 `</div>` 와 `</section>` 사이(클라이맥스 곡선 섹션 닫기 직전)에 범례 추가 — 다음 패턴을 찾아:
```tsx
            </div>
          </section>
        </div>

        {/* 비슷한 패턴의 영화 — 그래프(벡터)가 있는 영화만 표시 */}
```
다음으로 교체:
```tsx
            </div>

            {vector && valence && valence.length > 0 && (
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>어두운 분위기</span>
                <span style={{ flex: 1, height: 8, borderRadius: 4, background: 'linear-gradient(90deg, #2dd4bf, #7b61ff, #ff6ec7)' }} />
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>밝은 분위기</span>
              </div>
            )}
          </section>
        </div>

        {/* 비슷한 패턴의 영화 — 그래프(벡터)가 있는 영화만 표시 */}
```

- [ ] **Step 5: 유사 카드 렌더 — 구조분해 + MiniGraph valence 전달**

다음 줄을
```tsx
                  : similar.map(
                      ({ movie: m, vector: simVec, matchPct }, idx) => {
                        const simImg = posterUrl(m.poster_path);
                        const simGenres = genreList(m.genre).slice(0, 2);
                        const desc = climaxDescriptor(simVec);
```
로 교체:
```tsx
                  : similar.map(
                      ({ movie: m, arousal: simVec, valence: simVal, matchPct }, idx) => {
                        const simImg = posterUrl(m.poster_path);
                        const simGenres = genreList(m.genre).slice(0, 2);
                        const desc = climaxDescriptor(simVec);
```

그리고 미니그래프 줄을
```tsx
                            <div style={{ flex: 1, minWidth: 80, height: 76 }}>
                              <MiniGraph data={simVec} height={76} />
                            </div>
```
로 교체:
```tsx
                            <div style={{ flex: 1, minWidth: 80, height: 76 }}>
                              <MiniGraph data={simVec} valence={simVal} height={76} />
                            </div>
```

- [ ] **Step 6: 빌드(타입체크)**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE && npm run build 2>&1 | grep -E "Compiled|Failed|Error"`
Expected: `✓ Compiled successfully`

- [ ] **Step 7: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/components/DetailOverlay.tsx
git commit -m "feat(valence): DetailOverlay 쌍 fetch·가중 유사도(0.5/0.5)·valence 색·범례

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: 마무리

**Files:** (없음 — 검증/정리)

- [ ] **Step 1: 임시 검증 스크립트 제거**

```bash
rm -f /tmp/verify-color.mts /tmp/verify-center.mts
```

- [ ] **Step 2: 최종 빌드**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE && npm run build 2>&1 | tail -3`
Expected: `✓ Compiled successfully`

- [ ] **Step 3: 수동 확인 (배포 후)**

- 상세: 클라이맥스 곡선이 teal→purple→pink로 칠해지고, 아래 색 범례 표시. 호버 시 진행도/피크 + **분위기**(색 스와치 + 어두움/중립/밝음).
- 유사 추천: 미니그래프가 valence 색으로 칠해지고, MATCH%가 arousal+valence 0.5/0.5 결합으로 바뀜.
- valence 없는 영화: 단색(보라) 폴백, 에러 없음.

- [ ] **Step 4: finishing-a-development-branch**

**REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch
(테스트=순수 모듈 tsx 통과 + `npm run build` 통과로 게이트 갈음 → 병합/PR 옵션 제시.)

---

## Self-Review 메모

- **스펙 커버리지:** 팔레트A/정규화=T1, meanCenter=T2, 쌍 fetch=T3, 상세 색+호버분위기=T4, 미니 색=T5, 범례+가중유사도(0.5/0.5)=T6.
- **타입 일관성:** `fetchVectorPair`→`{arousal,valence}`, `fetchMovieVectorPairs`→`Map<number,{arousal,valence}>`, similar 항목 `{movie,arousal,valence,matchPct}`, `valenceGradientStops/valenceToUnit/valenceColorAt/meanCenter` 시그니처가 정의(T1/T2)와 사용처(T4/T5/T6) 일치. ClimaxGraph/MiniGraph `valence?: number[]` prop 일치.
- **placeholder:** 코드 스텝 전부 완전 코드. T3 Step3의 in.() 인코딩만 라이브 확인 분기(따옴표 폴백) 명시.
- **엣지:** valence 없는 영화 → 그래프 단색 폴백, 유사도 valence항을 arousal로 대체(가중 왜곡 방지), 범례 미표시.
