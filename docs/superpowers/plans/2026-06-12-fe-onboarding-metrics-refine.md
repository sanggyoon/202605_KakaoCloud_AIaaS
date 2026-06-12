# 온보딩 태그라인 · 지표 수식 · 그래프 스케일 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `movie_vectors`가 z-score 정규화 벡터임을 반영해 클라이맥스 지표 수식과 미니그래프 스케일을 바로잡고, 온보딩 태그라인에 세리프 폰트와 순차 등장 모션을 입힌다.

**Architecture:** 모든 지표/표시는 `app/lib/climax.ts` 순수 함수가 입력 배열을 **내부 z정규화**한 뒤 계산한다(입력 스케일 무관). 컴포넌트(`MiniGraph`, `page.tsx`)는 이 함수를 호출만 한다. BE/DB 변경 없음.

**Tech Stack:** Next.js 16 (App Router, RSC/client components), TypeScript, next/font(google), CSS keyframes. 테스트 러너 없음 → 순수 함수는 `npx tsx` 일회성 검증, 컴포넌트는 `next build`(타입체크) + 수동 확인.

**선행 스펙:** `docs/superpowers/specs/2026-06-12-fe-onboarding-metrics-refine-design.md`

**작업 디렉터리:** `/Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE` (git 루트는 동일 — 명령은 이 경로에서 실행). 모든 커밋 메시지 끝에:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## 사전 메모 (반드시 읽을 것)

- `app/lib/climax.ts`는 **이미 존재**한다. 이 작업은 기존 함수의 **수식을 교체**하고 `zscore`/`toDisplayScale`를 **추가**하는 것이다.
- 기존 export: `cosineSimilarity`(유지), `findPeaks`(→ `countPeaks`로 대체), `climaxMetrics`(수식 교체), `topPeaks`(수식 교체), 인터페이스 `ClimaxMetrics`/`TopPeak`(유지).
- `findPeaks`를 외부에서 import하는 곳이 있는지 먼저 확인하고, 없으면 제거한다(아래 Task 1 Step 0).
- `cosineSimilarity`는 절대 건드리지 않는다 — `DetailOverlay`가 유사도 재랭크에 사용 중.

---

## Task 1: `climax.ts` — z정규화 기반 수식 교체

**Files:**
- Modify: `app/lib/climax.ts`
- Verify(임시): `/tmp/verify-climax.mts`

- [ ] **Step 0: `findPeaks` 외부 사용처 확인**

Run:
```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE && grep -rn "findPeaks" app/
```
Expected: `app/lib/climax.ts` 정의/내부 호출만 나오고 다른 파일에서 import 없음.
만약 다른 파일이 `findPeaks`를 쓰면 멈추고 보고할 것(계획 전제 위반).

- [ ] **Step 1: 검증 스크립트(=테스트) 작성 — 새 동작 기준**

`/tmp/verify-climax.mts` 생성:
```ts
import assert from 'node:assert';
import { climaxMetrics, topPeaks, toDisplayScale } from '/Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE/app/lib/climax.ts';

// 1) 평탄 벡터: 변동 없음 → 강도 0, 피크 0, display 전부 50
const flat = Array(10).fill(5);
const fm = climaxMetrics(flat);
assert.strictEqual(fm.intensity, 0, 'flat intensity should be 0');
assert.strictEqual(fm.peakCount, 0, 'flat peakCount should be 0');
assert.deepStrictEqual(toDisplayScale(flat), Array(10).fill(50), 'flat display should be 50');

// 2) 단일 스파이크(길이 21, index 10 = 10, 나머지 0)
const spike = Array(21).fill(0); spike[10] = 10;
const sm = climaxMetrics(spike);
assert.strictEqual(sm.intensity, 10, 'spike intensity should clamp to 10');
assert.strictEqual(sm.peakPositionPct, 50, 'spike peak position should be 50%');
assert.strictEqual(sm.peakCount, 1, 'spike peakCount should be 1');
const sp = topPeaks(spike, 3);
assert.strictEqual(sp.length, 1, 'spike topPeaks length 1');
assert.ok(sp[0].label.includes('중반') && sp[0].label.includes('최고조'), `label was ${sp[0].label}`);
assert.strictEqual(sp[0].valuePct, 100, 'spike peak valuePct clamps to 100');

// 3) 분리 윈도: 멀리 떨어진 두 스파이크 → 2개
const two = Array(41).fill(0); two[10] = 10; two[30] = 10;
assert.strictEqual(climaxMetrics(two).peakCount, 2, 'two far spikes → 2');

// 4) 인접(윈도 내) 두 스파이크 → 1개(앞쪽만)
const near = Array(41).fill(0); near[10] = 10; near[12] = 10;
assert.strictEqual(climaxMetrics(near).peakCount, 1, 'two near spikes merge → 1');

// 5) toDisplayScale 범위 [0,100]
const ds = toDisplayScale(spike);
assert.ok(Math.min(...ds) >= 0 && Math.max(...ds) <= 100, 'display in [0,100]');

console.log('ALL CLIMAX CHECKS PASSED');
```

- [ ] **Step 2: 검증 실행 → 실패 확인(기존 수식)**

Run:
```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE && npx --yes tsx /tmp/verify-climax.mts
```
Expected: FAIL. `toDisplayScale`가 아직 없어 import 에러이거나, 있어도 기존 `intensity=max/10`(=0.5) 단언에서 실패.
(네트워크 차단으로 `npx tsx` 불가 시: `npm i -D tsx` 후 `npx tsx ...` 또는 `node --experimental-strip-types`로 대체. 환경 제약이면 사용자에게 알릴 것.)

- [ ] **Step 3: `climax.ts` 수식 교체 구현**

`app/lib/climax.ts`에서 `cosineSimilarity`는 그대로 두고, 그 아래 `meanStd`/`findPeaks`/`climaxMetrics`/`topPeaks` 전체를 다음으로 교체:

```ts
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
```

상단 주석(파일 1행)도 `// movie_vectors 클라이맥스 곡선(z-score)에서 파생 지표/피크/유사도 계산 (순수 함수)`로 갱신.

- [ ] **Step 4: 검증 실행 → 통과 확인**

Run:
```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE && npx --yes tsx /tmp/verify-climax.mts
```
Expected: `ALL CLIMAX CHECKS PASSED`

- [ ] **Step 5: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE
git add app/lib/climax.ts
git commit -m "fix(climax): z-score 기반 강도·피크 수식 재정립 + toDisplayScale 추가

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `MiniGraph` 고정 display 스케일 적용

**Files:**
- Modify: `app/components/MiniGraph.tsx`

- [ ] **Step 1: import 추가**

`app/components/MiniGraph.tsx` 상단(`'use client';` 아래)에 추가:
```ts
import { toDisplayScale } from '@/app/lib/climax';
```

- [ ] **Step 2: data/reference를 display 스케일로 변환해 Y매핑**

함수 본문에서 `const pts = data.map(...)` 직전에 변환 배열을 만들고, `v/100` 대신 변환값을 사용한다.

`const pts = ...` 라인을 다음으로 교체:
```ts
  const ds = toDisplayScale(data);
  // ds는 이미 0~100 → 그대로 높이에 대응
  const pts = data.map((_, i) => [padX + (i / (data.length - 1)) * innerW, 2 + innerH - (ds[i] / 100) * innerH]);
```

reference 경로의 `const rpts = reference.map(...)` 라인을 다음으로 교체(바로 위에 `const rs` 추가):
```ts
    const rs = toDisplayScale(reference);
    const rpts = reference.map((_, i) => [padX + (i / (reference.length - 1)) * innerW, 2 + innerH - (rs[i] / 100) * innerH]);
```

(주석 1행도 `// 클라이맥스 곡선(z-score)을 고정 display 스케일로 베지어 렌더링`으로 갱신.)

- [ ] **Step 3: 타입체크/빌드**

Run:
```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE && npm run build 2>&1 | tail -20
```
Expected: `✓ Compiled successfully`. (기존 react-hooks/set-state-in-effect lint 경고는 무시 — 빌드는 통과.)

- [ ] **Step 4: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE
git add app/components/MiniGraph.tsx
git commit -m "fix(minigraph): z-score 벡터를 고정 display 스케일로 그려 굴곡 복원

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 온보딩 태그라인 — 세리프 폰트 + 순차 등장 모션

**Files:**
- Modify: `app/layout.tsx` (next/font 추가)
- Modify: `app/globals.css` (keyframes 추가)
- Modify: `app/page.tsx` (태그라인 마크업/스타일)

- [ ] **Step 1: `Nanum_Myeongjo` 폰트 등록 (`layout.tsx`)**

`app/layout.tsx`의 next/font import 라인을 다음으로 교체(기존 3개에 추가):
```ts
import { Inter_Tight, Playfair_Display, JetBrains_Mono, Nanum_Myeongjo } from "next/font/google";
```

기존 폰트 선언부(예: `const jetbrains = JetBrains_Mono({...})`) 아래에 추가:
```ts
const nanumMyeongjo = Nanum_Myeongjo({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-serif-ko",
});
```
(`Nanum_Myeongjo`는 한글 글리프를 폰트 파일에 포함하므로 `subsets:["latin"]`만 선언해도 한글 렌더 정상. weight 미지정 시 빌드 에러나므로 명시 필수.)

`<body className={...}>` 또는 `<html className={...}>`의 className 템플릿에 `${nanumMyeongjo.variable}` 추가(기존 `${jetbrains.variable}` 등과 같은 자리).

- [ ] **Step 2: keyframes 추가 (`globals.css`)**

`app/globals.css` 끝에 추가:
```css
/* 온보딩 태그라인 단어 순차 등장 */
@keyframes taglineUp {
  to { opacity: 1; transform: translateY(0); }
}
```

- [ ] **Step 3: 태그라인 마크업/스타일 교체 (`page.tsx`)**

`app/page.tsx`에서 기존 태그라인 블록(`{/* 서비스 태그라인 */}` 주석과 그 아래 단일 `<p>...한 편의 감정을 데이터로 그리다</p>`)을 다음으로 교체:
```tsx
        {/* 서비스 태그라인 — 세리프 + 단어 순차 등장 + 핵심어 글로우 */}
        <p
          style={{
            fontSize: 'clamp(20px, 4.4vw, 30px)',
            fontWeight: 700,
            lineHeight: 1.5,
            color: 'rgba(255,255,255,0.9)',
            margin: '0 auto 52px',
            maxWidth: 560,
            letterSpacing: '-0.01em',
            fontFamily: 'var(--font-serif-ko), serif',
          }}
        >
          <span className="tagline-word" style={{ animationDelay: '0.1s' }}>한 편의 </span>
          <span className="tagline-word" style={{ animationDelay: '0.35s' }}>
            <em className="tagline-key">감정</em>을{' '}
          </span>
          <span className="tagline-word" style={{ animationDelay: '0.6s' }}>
            <em className="tagline-key">데이터</em>로{' '}
          </span>
          <span className="tagline-word" style={{ animationDelay: '0.85s' }}>그리다</span>
        </p>
```

같은 파일에서 위 `<p>` 바로 위(또는 컴포넌트 return 내 적절한 곳)는 건드리지 않는다. 클래스 스타일은 `globals.css`가 아닌 인라인+클래스 혼용을 피하기 위해 `page.tsx` 내 `<style jsx>` 대신 **globals.css에 클래스 정의**를 추가한다(다음 스텝).

- [ ] **Step 4: 태그라인 클래스 정의 (`globals.css`)**

`app/globals.css` 끝(Step 2 keyframes 아래)에 추가:
```css
.tagline-word {
  display: inline-block;
  opacity: 0;
  transform: translateY(10px);
  animation: taglineUp 0.6s ease forwards;
}
.tagline-key {
  font-style: normal;
  font-weight: 700;
  color: var(--accent);
  text-shadow: 0 0 18px rgba(123, 97, 255, 0.55);
}
```

- [ ] **Step 5: 타입체크/빌드**

Run:
```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE && npm run build 2>&1 | tail -20
```
Expected: `✓ Compiled successfully`.

- [ ] **Step 6: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE
git add app/layout.tsx app/globals.css app/page.tsx
git commit -m "feat(onboarding): 태그라인 세리프 폰트 + 단어 순차 등장 모션 + 핵심어 글로우

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 마무리 — 정리 + 빌드 재확인

**Files:** (없음 — 검증/정리)

- [ ] **Step 1: 임시 검증 스크립트 제거**

```bash
rm -f /tmp/verify-climax.mts
```

- [ ] **Step 2: 전체 빌드 최종 확인**

Run:
```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE && npm run build 2>&1 | tail -20
```
Expected: `✓ Compiled successfully`.

- [ ] **Step 3: 수동 확인 안내 (배포 후)**

확인 항목:
- 온보딩: 태그라인이 세리프로 바뀌고 단어가 순차로 떠오르며 "감정"·"데이터"가 보라색으로 빛나는가.
- 상세 오버레이: 클라이맥스 강도가 영화마다 다르게(0~10 분포) 나오는가, 긴장 피크가 3~6개 수준인가, 절정 위치가 그대로인가.
- 유사 추천: 미니그래프가 직선이 아니라 굴곡을 보이고, 현재 영화 점선과 비교 가능한가.

- [ ] **Step 4: finishing-a-development-branch 스킬로 마무리**

**REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch
(테스트 러너 없음 → Step 1~2 빌드 통과로 검증 갈음. 그 후 병합/PR 옵션 제시.)

---

## Self-Review 메모

- **스펙 커버리지:** req1=Task3, req2=Task1, req3=Task1(toDisplayScale)+Task2. 측정 근거·스케일 견고성 반영됨.
- **타입 일관성:** `toDisplayScale`/`climaxMetrics`/`topPeaks` 시그니처가 Task1 정의와 Task2/`DetailOverlay`(불변) 사용처 일치. `ClimaxMetrics`/`TopPeak` 인터페이스·필드명 유지.
- **DetailOverlay 영향:** `climaxMetrics`/`topPeaks` 반환 형태(필드명) 동일 → 렌더 코드 수정 불필요. `findPeaks` 외부 미사용 전제(Task1 Step0에서 확인).
