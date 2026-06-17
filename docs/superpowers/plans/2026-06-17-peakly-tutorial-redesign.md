# Peakly 튜토리얼 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로토타입 튜토리얼을 Peakly 현재 서비스에 맞는 5단계(환영/그래프/필터링/랜덤픽/상세모달) 중앙 모달 캐러셀로 전면 재작성한다.

**Architecture:** `Tutorial.tsx`를 단일 backdrop + 중앙 카드 캐러셀로 재작성하고, 단계별 자체 완결형 데모 서브컴포넌트를 같은 파일에 둔다. 데모는 라이브 fetch 없이 정적 더미 데이터/SVG로 구성하며, 곡선 색은 기존 `MiniGraph`/`app/lib/color.ts` valence 팔레트를 재사용한다. `dashboard/page.tsx`에서 헤더 spotlight 로직을 제거하고 localStorage 키를 교체한다.

**Tech Stack:** Next.js (커스텀 버전 — `4K_FE/AGENTS.md` 준수), React client component, 인라인 스타일/SVG. 테스트 러너 없음 → 검증은 `npx tsc --noEmit` + `npm run lint` + 실제 앱 시각 확인.

**스펙 참조:** `docs/superpowers/specs/2026-06-17-peakly-tutorial-redesign-design.md`

---

## 사전 확인 (구현 시작 전)

- [ ] **Step 0: Next.js 가이드 확인**

`4K_FE/AGENTS.md`에 따라 이 프로젝트는 표준 Next.js와 다르다. 클라이언트 컴포넌트/스타일만 다루므로 큰 변경은 없지만, 작업 전 다음을 확인한다.

Run: `ls 4K_FE/node_modules/next/dist/docs/ 2>/dev/null | head`
관련 문서가 있으면 client component 규칙을 확인한다. (이번 작업은 기존 `'use client'` 패턴을 그대로 따르므로 새 API 도입 없음.)

작업 디렉터리: 모든 명령은 `4K_FE/`에서 실행한다(`cd 4K_FE`).

---

## Task 1: 더미 데이터 + STEP 메타 정의

새 `Tutorial.tsx`의 토대. 기존 파일을 백업 개념으로 덮어쓰기 시작한다. 이 태스크에서는 상수와 타입만 정의하고, 렌더는 placeholder로 둔 뒤 빌드가 통과하는지 본다.

**Files:**
- Modify: `4K_FE/app/components/Tutorial.tsx` (전면 재작성 시작)

- [ ] **Step 1: 파일 상단 — imports, 더미 데이터, STEP 메타 작성**

`Tutorial.tsx`의 내용을 아래로 교체한다(이 태스크 범위는 상단부 + 임시 return).

```tsx
'use client';

// Peakly 온보딩 튜토리얼 — 중앙 모달 캐러셀(5단계) + 단계별 자체 완결형 데모.
// 데모는 라이브 데이터를 fetch하지 않고 정적 더미/SVG로 구성한다.
import { useState } from 'react';
import MiniGraph from './MiniGraph';

interface TutorialProps {
  step: number;
  onNext: () => void;
  onSkip: () => void;
  onComplete: () => void;
}

// 클라이맥스 곡선 더미 (arousal). 촘촘한 굴곡으로 실제 곡선 느낌.
const DEMO_AROUSAL = [
  6, 30, 14, 40, 20, 46, 26, 52, 18, 44, 33, 58, 12, 48, 30, 54,
  22, 64, 40, 78, 30, 60, 44, 88, 28, 56, 70, 95, 38, 62, 26, 50,
];
// 분위기 더미 (valence). 0~1 정규화 전 임의 스케일 — 색 흐름 표현용.
const DEMO_VALENCE = [
  2, 3, 2, 5, 3, 6, 4, 7, 3, 6, 5, 8, 3, 7, 5, 9,
  4, 8, 6, 9, 5, 7, 6, 9, 4, 7, 8, 9, 5, 7, 4, 6,
];

// 단계 메타. demo는 step 인덱스로 스위치한다(아래 렌더).
const STEPS = [
  {
    label: 'STEP 1 / 5',
    title: 'Peakly에 오신 걸 환영합니다',
    desc: '영화의 감정 흐름을 선으로 그려, 당신의 클라이맥스에 맞는 영화를 찾아드려요.',
    action: '시작하기',
  },
  {
    label: 'STEP 2 / 5',
    title: '감정을 선으로 읽다',
    desc: '높이는 감정의 고조, 색은 분위기를 나타냅니다. 어두운 분위기에서 밝은 분위기까지.',
    action: '다음',
  },
  {
    label: 'STEP 3 / 5',
    title: '원하는 조건으로 좁히기',
    desc: '제목 검색, 연도 범위, 선호·비선호 장르, 선호·비선호 영화로 추천 풀을 좁힙니다.',
    action: '다음',
  },
  {
    label: 'STEP 4 / 5',
    title: '고민될 땐 랜덤픽',
    desc: '무엇을 볼지 모르겠다면, 전체 DB에서 무작위로 한 편을 골라드려요.',
    action: '다음',
  },
  {
    label: 'STEP 5 / 5',
    title: '더 깊이: 클라이맥스 커브',
    desc: '포스터를 누르면 전체 감정 곡선과 비슷한 패턴의 영화까지 볼 수 있어요.',
    action: '시작하기',
  },
];

export default function Tutorial({ step, onNext, onSkip, onComplete }: TutorialProps) {
  const current = STEPS[step];
  // 임시 렌더 — Task 3에서 교체
  return (
    <div data-tutorial-placeholder style={{ position: 'fixed', inset: 0, zIndex: 41 }}>
      {current.title}
      <button onClick={step === STEPS.length - 1 ? onComplete : onNext}>{current.action}</button>
      <button onClick={onSkip}>스킵</button>
    </div>
  );
}
```

- [ ] **Step 2: 타입체크로 컴파일 확인**

Run: `cd 4K_FE && npx tsc --noEmit`
Expected: 에러 없음(통과). `MiniGraph`/`DEMO_*`가 아직 미사용이라도 `const`는 경고 대상 아님. 만약 unused 에러가 나면 Task 2에서 사용하므로, 이 단계에선 `MiniGraph` import만 잠시 주석 처리하지 말고 Task 2를 곧바로 진행한다.

- [ ] **Step 3: 커밋**

```bash
cd 4K_FE && git add app/components/Tutorial.tsx
git commit -m "refactor(tutorial): Peakly 5단계 메타/더미 데이터 토대"
```

---

## Task 2: 데모 서브컴포넌트 5종

각 단계 데모를 self-contained 컴포넌트로 작성한다. 모두 props 없이 시각 표현만 담당. `Tutorial.tsx` 안, `export default` 위에 추가한다.

**Files:**
- Modify: `4K_FE/app/components/Tutorial.tsx`

- [ ] **Step 1: 공통 데모 래퍼 + 5개 데모 컴포넌트 작성**

`export default function Tutorial` 정의 **바로 위**에 아래를 추가한다.

```tsx
// 데모 영역 공통 래퍼 — 카드 안 약 150px 높이 박스
function DemoBox({ children, cap }: { children: React.ReactNode; cap?: string }) {
  return (
    <div style={{
      position: 'relative', height: 150, marginBottom: 18,
      borderRadius: 12, background: '#0a0712',
      border: '1px solid rgba(255,255,255,0.07)', overflow: 'hidden',
      display: 'grid', placeItems: 'center',
    }}>
      {children}
      {cap && (
        <div style={{
          position: 'absolute', bottom: 8, left: 0, right: 0, textAlign: 'center',
          fontSize: 8, fontWeight: 800, letterSpacing: '0.16em', color: 'rgba(255,255,255,0.38)',
        }}>{cap}</div>
      )}
    </div>
  );
}

// STEP 1 — 로고 글로우 + 태그라인
function DemoWelcome() {
  return (
    <DemoBox cap="WELCOME">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          background: 'linear-gradient(145deg, #7b61ff, #3a1a9e)',
          boxShadow: '0 0 32px color-mix(in oklch, var(--accent) 55%, transparent)',
          display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 24, color: '#fff',
        }}>P</div>
        <div style={{
          fontFamily: 'var(--font-serif-ko), serif', fontSize: 13, fontWeight: 700,
          color: 'rgba(255,255,255,0.85)',
        }}>한 편의 감정을 선으로 그리다</div>
      </div>
    </DemoBox>
  );
}

// STEP 2 — 그려지는 클라이맥스 곡선 (valence 색)
function DemoGraph() {
  return (
    <DemoBox cap="CLIMAX GRAPH">
      <div style={{ width: '88%', height: 92 }}>
        <MiniGraph data={DEMO_AROUSAL} valence={DEMO_VALENCE} height={92} />
      </div>
      <div style={{ position: 'absolute', left: 12, top: 12, fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,0.55)' }}>↑ 높이 = 고조</div>
      <div style={{ position: 'absolute', right: 12, top: 30, fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,0.55)' }}>색 = 분위기</div>
    </DemoBox>
  );
}

// STEP 3 — 미니 필터 데모 (검색/장르 pill)
function DemoFilters() {
  const pill = (text: string, kind: 'on' | 'no' | 'off') => {
    const map = {
      on: { bg: 'color-mix(in oklch, var(--accent) 18%, transparent)', bd: 'color-mix(in oklch, var(--accent) 45%, transparent)', fg: 'var(--accent)' },
      no: { bg: 'rgba(255,80,80,0.15)', bd: 'rgba(255,100,100,0.4)', fg: '#ff7070' },
      off: { bg: 'rgba(255,255,255,0.05)', bd: 'rgba(255,255,255,0.1)', fg: 'rgba(255,255,255,0.7)' },
    }[kind];
    return (
      <span key={text} style={{
        fontSize: 9, fontWeight: 700, padding: '4px 9px', borderRadius: 999,
        background: map.bg, border: `1px solid ${map.bd}`, color: map.fg,
      }}>{text}</span>
    );
  };
  return (
    <DemoBox cap="FILTERS">
      <div style={{ width: '86%', display: 'flex', flexDirection: 'column', gap: 9, alignItems: 'center' }}>
        <div style={{
          width: '100%', height: 22, borderRadius: 7, display: 'flex', alignItems: 'center', padding: '0 9px',
          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
          fontSize: 9, color: 'rgba(255,255,255,0.4)',
        }}>🔍 영화 제목…</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, justifyContent: 'center' }}>
          {pill('드라마', 'on')}{pill('SF', 'off')}{pill('공포', 'no')}{pill('로맨스', 'off')}
        </div>
      </div>
    </DemoBox>
  );
}

// STEP 4 — 포스터 셔플 → 한 장 확정
function DemoRandom() {
  const poster = (pick = false) => (
    <div style={{
      width: 34, aspectRatio: '2/3', borderRadius: 5,
      background: 'linear-gradient(145deg, #2a1a55, #140a30)',
      outline: pick ? '2px solid var(--accent)' : 'none',
      boxShadow: pick ? '0 0 20px color-mix(in oklch, var(--accent) 55%, transparent)' : 'none',
    }} />
  );
  return (
    <DemoBox cap="RANDOM PICK">
      <div style={{ display: 'flex', gap: 7 }}>
        {poster()}{poster()}{poster(true)}{poster()}
      </div>
    </DemoBox>
  );
}

// STEP 5 — 상세 모달(클라이맥스 커브 + 분위기 범례 + 유사영화 행)
function DemoDetail() {
  const simRow = (pct: string, name: string, meta: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ width: 30, fontSize: 16, fontWeight: 900, fontStyle: 'italic', letterSpacing: '-0.03em', flexShrink: 0 }}>{pct}<sup style={{ fontSize: 8 }}>%</sup></div>
      <div style={{ width: 20, aspectRatio: '2/3', borderRadius: 3, background: 'linear-gradient(145deg, #2a1a55, #140a30)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
        <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.4)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta}</div>
      </div>
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>›</span>
    </div>
  );
  return (
    <div style={{
      position: 'relative', marginBottom: 18, borderRadius: 12, background: '#07060e',
      border: '1px solid rgba(255,255,255,0.07)', padding: '12px 12px 11px', textAlign: 'left',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
        <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.18em', color: 'var(--accent)' }}>CLIMAX CURVE</span>
        <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.4)' }}>자막·장면 AI 분석</span>
      </div>
      <div style={{ height: 56 }}>
        <MiniGraph data={DEMO_AROUSAL} valence={DEMO_VALENCE} height={56} />
      </div>
      {/* 분위기 범례 바 */}
      <div style={{ marginTop: 7 }}>
        <div style={{ height: 6, borderRadius: 9, background: 'linear-gradient(90deg, #2dd4bf, #7b61ff, #ff6ec7)' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 6.5, color: 'rgba(255,255,255,0.45)', marginTop: 3 }}>
          <span>어두운 분위기</span><span>밝은 분위기</span>
        </div>
      </div>
      <div style={{ fontSize: 7.5, fontWeight: 800, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.5)', margin: '12px 0 6px' }}>비슷한 패턴의 영화 · 클라이맥스 유사도 기반</div>
      {simRow('48', "'고스팅' - Ghosted", '2023 · 액션 · 코미디 · 중반 정점의 산형 곡선')}
      {simRow('43', '캐스트 어웨이', '2000 · 모험 · 드라마 · 초반부터 달아오르는 곡선')}
    </div>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `cd 4K_FE && npx tsc --noEmit`
Expected: 통과. (데모 컴포넌트가 아직 Tutorial 본문에서 호출되지 않아 unused 경고가 있을 수 있으나 tsc는 unused-local을 error로 올리지 않는 한 통과. Task 3에서 즉시 사용.)

- [ ] **Step 3: 커밋**

```bash
cd 4K_FE && git add app/components/Tutorial.tsx
git commit -m "feat(tutorial): 5단계 데모 서브컴포넌트(welcome/graph/filters/random/detail)"
```

---

## Task 3: Tutorial 본문 렌더 (모달 카드 + dots + 버튼)

임시 placeholder return을 실제 모달 캐러셀로 교체한다.

**Files:**
- Modify: `4K_FE/app/components/Tutorial.tsx` (`export default function Tutorial` 본문)

- [ ] **Step 1: 본문 교체**

`export default function Tutorial(...) { ... }`의 내용을 아래로 교체한다.

```tsx
export default function Tutorial({ step, onNext, onSkip, onComplete }: TutorialProps) {
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const demo = [<DemoWelcome />, <DemoGraph />, <DemoFilters />, <DemoRandom />, <DemoDetail />][step];

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 40 }}
      />

      {/* Modal */}
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        zIndex: 41, width: 'min(344px, calc(100vw - 32px))',
        background: 'linear-gradient(160deg, rgba(22,18,40,0.98) 0%, rgba(10,9,18,0.98) 100%)',
        border: '1px solid rgba(123,97,255,0.22)', borderRadius: 18,
        padding: '26px 22px 22px',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 60px color-mix(in oklch, var(--accent) 10%, transparent)',
        animation: 'fadeIn 0.22s ease', textAlign: 'center',
      }}>
        {/* Step label */}
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.2em', color: 'var(--accent)', marginBottom: 12 }}>
          {current.label}
        </div>

        {/* Title */}
        <h2 style={{ margin: '0 0 9px', fontSize: 19, fontWeight: 800, letterSpacing: '-0.02em' }}>
          {current.title}
        </h2>

        {/* Description */}
        <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'rgba(255,255,255,0.58)', lineHeight: 1.6 }}>
          {current.desc}
        </p>

        {/* Demo */}
        {demo}

        {/* Progress dots */}
        <div style={{ display: 'flex', gap: 5, justifyContent: 'center', marginBottom: 16 }}>
          {STEPS.map((_, i) => (
            <span key={i} style={{
              width: i === step ? 18 : 6, height: 6, borderRadius: 9,
              background: i === step ? 'var(--accent)' : 'rgba(255,255,255,0.2)',
              transition: 'width 0.2s, background 0.2s',
            }} />
          ))}
        </div>

        {/* Footer buttons */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <button
            onClick={onSkip}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.4)', fontSize: 13, fontWeight: 500,
              padding: '4px 8px', fontFamily: 'inherit',
            }}
          >스킵</button>
          <button
            onClick={isLast ? onComplete : onNext}
            style={{
              flex: 1, padding: '13px 20px', background: 'var(--accent)',
              border: 'none', borderRadius: 10, color: 'black', fontSize: 14, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
              boxShadow: '0 4px 20px color-mix(in oklch, var(--accent) 30%, transparent)',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.88'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
          >{current.action}</button>
        </div>
      </div>
    </>
  );
}
```

참고: `useState` import는 이제 본문에서 미사용이다. Step 2에서 정리한다.

- [ ] **Step 2: 미사용 import 제거**

`Tutorial.tsx` 최상단의 import에서 `useState`를 제거한다(데모/본문 모두 상태를 쓰지 않음).

변경 전:
```tsx
import { useState } from 'react';
import MiniGraph from './MiniGraph';
```
변경 후:
```tsx
import MiniGraph from './MiniGraph';
```

- [ ] **Step 3: 타입체크 + lint**

Run: `cd 4K_FE && npx tsc --noEmit && npm run lint`
Expected: 둘 다 통과. `fadeIn` 키프레임은 기존 globals.css에 정의돼 있음(기존 튜토리얼이 사용 중이었음).

- [ ] **Step 4: 커밋**

```bash
cd 4K_FE && git add app/components/Tutorial.tsx
git commit -m "feat(tutorial): 중앙 모달 캐러셀 본문(dots/버튼/데모 스위치)"
```

---

## Task 4: dashboard 와이어링 (spotlight 제거 + localStorage 키 교체)

**Files:**
- Modify: `4K_FE/app/dashboard/page.tsx`

- [ ] **Step 1: localStorage 키 교체 (초기화)**

`dashboard/page.tsx`의 tutorialStep 초기화에서 키를 교체한다.

변경 전:
```tsx
  const [tutorialStep, setTutorialStep] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('4k_tutorial_done') === '1' ? null : 0;
  });
```
변경 후:
```tsx
  const [tutorialStep, setTutorialStep] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('peakly_tutorial_done') === '1' ? null : 0;
  });
```

- [ ] **Step 2: localStorage 키 교체 (완료 기록)**

같은 파일 `closeTutorial`에서 키를 교체한다.

변경 전:
```tsx
  const closeTutorial = () => {
    setTutorialStep(null);
    localStorage.setItem('4k_tutorial_done', '1');
  };
```
변경 후:
```tsx
  const closeTutorial = () => {
    setTutorialStep(null);
    localStorage.setItem('peakly_tutorial_done', '1');
  };
```

- [ ] **Step 3: 헤더 spotlight 로직 제거**

스폿라이트 관련은 정확히 3곳이다(211-212행 선언, 273행 사용). 헤더가 더 이상 튜토리얼에서 강조되지 않으므로 항상 기본 zIndex(5)로 고정한다.

- 선언 두 줄(211-212행)을 **삭제**한다:
```tsx
  // 튜토리얼 step 1~2에서는 헤더를 backdrop보다 위에 노출해 강조
  const isHeaderHighlighted = tutorialStep === 1 || tutorialStep === 2;
  const headerZIndex = isHeaderHighlighted ? 50 : 5;
```
(위 두 줄 위의 주석 한 줄 포함, 총 3줄 제거.)

- 사용처(273행 부근) `zIndex: headerZIndex,` 를 고정값으로 치환한다:

변경 전:
```tsx
          zIndex: headerZIndex,
```
변경 후:
```tsx
          zIndex: 5,
```

> 검증: 헤더가 backdrop(zIndex 40) 아래로 정상적으로 덮이는지 Step 5 시각 확인에서 본다.

- [ ] **Step 4: 타입체크 + lint**

Run: `cd 4K_FE && npx tsc --noEmit && npm run lint`
Expected: 통과. `isHeaderHighlighted` 미사용 변수 에러가 없어야 함(완전 제거됐는지 확인). 만약 "isHeaderHighlighted is not defined" 또는 unused 에러가 나면 Step 3의 누락 사용처/잔여 선언을 정리한다.

- [ ] **Step 5: 시각 확인 (dev 서버)**

Run: `cd 4K_FE && npm run dev` 후 브라우저에서 `/dashboard` 접속(필요 시 `localStorage.removeItem('peakly_tutorial_done')` 후 새로고침).
Expected:
- 5단계가 순서대로(환영→그래프→필터링→랜덤픽→상세) 표시되고 문구가 스펙과 일치.
- 각 데모가 깨지지 않고 렌더(그래프 색이 teal→purple→pink).
- dots가 현재 단계 강조, `다음`/`시작하기` 동작.
- `스킵` 또는 `시작하기` 후 새로고침 시 재노출 안 됨.
- 헤더 ? 버튼 클릭 시 step 0부터 재시작.
- 모바일 폭(개발자도구 375px)에서 카드가 화면을 넘지 않음(`min(344px, calc(100vw - 32px))`).

- [ ] **Step 6: 커밋**

```bash
cd 4K_FE && git add app/dashboard/page.tsx
git commit -m "feat(tutorial): dashboard 와이어링 — spotlight 제거 + peakly_tutorial_done 키"
```

---

## Task 5: 최종 빌드 검증

**Files:** 없음(검증만)

- [ ] **Step 1: 프로덕션 빌드**

Run: `cd 4K_FE && npm run build`
Expected: 빌드 성공(타입/lint 에러 없이 완료).

- [ ] **Step 2: 최종 시각 회귀 확인**

`npm run dev`에서 Task 4 Step 5의 모든 항목을 한 번 더 확인하고, 데스크탑/모바일 양쪽에서 5단계를 끝까지 통과한다.

- [ ] **Step 3: (변경 없으면 커밋 생략)**

빌드만 통과 확인. 코드 변경이 없으면 커밋하지 않는다.

---

## 완료 기준 (스펙 §10 대응)

- [ ] 5단계가 순서대로 렌더 + 문구가 스펙 §3과 일치
- [ ] 모바일 폭에서 카드/데모가 깨지지 않음
- [ ] `peakly_tutorial_done`로 재노출 차단 동작
- [ ] 헤더 ? 버튼으로 재시작
- [ ] 그래프 데모 색이 valence 팔레트(teal→purple→pink)
- [ ] `npm run build` 통과
