# 튜토리얼 "앱 설치 방법" 스텝 추가 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Peakly 튜토리얼에 6번째 스텝(홈 화면 앱 설치 방법)을 추가하고, 모바일 OS를 감지해 해당 플랫폼 안내만(데스크탑은 둘 다) 보여준다.

**Architecture:** 기존 `Tutorial.tsx` 단일 파일만 수정한다. `STEPS` 배열에 6번째 항목 추가(라벨 `/6`, 기존 5번 action을 `다음`으로), `DemoInstall` 컴포넌트(플랫폼 감지 + 단계 안내) 신규 추가, `demo` 배열에 연결. 데이터/네트워크 없음(정적 UI).

**Tech Stack:** Next.js 16 client component, React `useState`/`useEffect`, 인라인 스타일. 테스트 러너 없음 → 검증은 `npx tsc --noEmit` + `npm run lint` + `npm run build` + dev 시각 확인(DevTools 디바이스 토글).

**스펙 참조:** `docs/superpowers/specs/2026-06-17-tutorial-install-step-design.md`

**작업 디렉터리:** 모든 명령은 `4K_FE/`에서. 셸 cwd 리셋 대비 각 Bash는 절대경로 `cd`로 시작.

---

## Task 1: imports + STEPS 6스텝화

**Files:**
- Modify: `4K_FE/app/components/Tutorial.tsx`

- [ ] **Step 1: React 훅 import 추가**

변경 전:
```tsx
import MiniGraph from './MiniGraph';
```
변경 후:
```tsx
import { useEffect, useState } from 'react';
import MiniGraph from './MiniGraph';
```

- [ ] **Step 2: STEPS 라벨 `/5`→`/6` + 5번 action 변경 + 6번 추가**

`STEPS` 배열 전체를 아래로 교체한다(라벨 6개 모두 `/6`, 기존 STEP 5 action `시작하기`→`다음`, STEP 6 신규).

변경 전: 기존 `const STEPS = [ ... ];` (STEP 1~5, 라벨 `/5`).

변경 후:
```tsx
const STEPS = [
  {
    label: 'STEP 1 / 6',
    title: 'Peakly에 오신 걸 환영합니다',
    desc: '영화의 감정 흐름을 선으로 그려, 당신의 클라이맥스에 맞는 영화를 찾아드려요.',
    action: '시작하기',
  },
  {
    label: 'STEP 2 / 6',
    title: '감정을 선으로 읽다',
    desc: '높이는 감정의 고조, 색은 분위기를 나타냅니다. 어두운 분위기에서 밝은 분위기까지.',
    action: '다음',
  },
  {
    label: 'STEP 3 / 6',
    title: '원하는 조건으로 좁히기',
    desc: '제목 검색, 연도 범위, 선호·비선호 장르, 선호·비선호 영화로 추천 풀을 좁힙니다.',
    action: '다음',
  },
  {
    label: 'STEP 4 / 6',
    title: '고민될 땐 랜덤픽',
    desc: '무엇을 볼지 모르겠다면, 전체 DB에서 무작위로 한 편을 골라드려요.',
    action: '다음',
  },
  {
    label: 'STEP 5 / 6',
    title: '더 깊이: 클라이맥스 커브',
    desc: '포스터를 누르면 전체 감정 곡선과 비슷한 패턴의 영화까지 볼 수 있어요.',
    action: '다음',
  },
  {
    label: 'STEP 6 / 6',
    title: '휴대폰에 앱으로 설치하기',
    desc: '홈 화면에 추가하면 주소창 없이 앱처럼 빠르게 열려요.',
    action: '시작하기',
  },
];
```

- [ ] **Step 3: 타입체크**

Run: `cd 4K_FE && npx tsc --noEmit`
Expected: 통과(출력 없음). 이 시점엔 `useEffect/useState`가 아직 미사용이라 tsc는 통과(noUnusedLocals 미설정). Task 2에서 사용.

- [ ] **Step 4: 커밋**

```bash
cd 4K_FE && git add app/components/Tutorial.tsx
git commit -m "feat(tutorial): 6스텝화(라벨 /6) + STEP 6(앱 설치) 메타 추가"
```

---

## Task 2: `DemoInstall` 컴포넌트

**Files:**
- Modify: `4K_FE/app/components/Tutorial.tsx`

- [ ] **Step 1: DemoInstall 추가**

`export default function Tutorial` 정의 **바로 위**(기존 `DemoDetail` 함수 다음)에 아래를 추가한다.

```tsx
// STEP 6 — 홈 화면 설치 안내. userAgent로 플랫폼 감지(데스크탑은 둘 다).
function DemoInstall() {
  const [platform, setPlatform] = useState<'ios' | 'android' | 'both'>('both');

  useEffect(() => {
    const ua = navigator.userAgent;
    const isIOS =
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(ua);
    setPlatform(isIOS ? 'ios' : isAndroid ? 'android' : 'both');
  }, []);

  const stepRow = (n: number, text: string) => (
    <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
      <span style={{
        flexShrink: 0, width: 16, height: 16, borderRadius: 999,
        background: 'color-mix(in oklch, var(--accent) 22%, transparent)',
        color: 'var(--accent)', fontSize: 9, fontWeight: 800,
        display: 'grid', placeItems: 'center',
      }}>{n}</span>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.72)' }}>{text}</span>
    </div>
  );

  const block = (label: string, s1: string, s2: string) => (
    <div key={label} style={{
      borderRadius: 10, background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.07)', padding: '11px 13px',
    }}>
      <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.16em', color: 'var(--accent)' }}>{label}</div>
      {stepRow(1, s1)}
      {stepRow(2, s2)}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18, textAlign: 'left' }}>
      {(platform === 'ios' || platform === 'both') &&
        block('iOS · SAFARI', '하단 공유 버튼을 탭', '"홈 화면에 추가" 선택')}
      {(platform === 'android' || platform === 'both') &&
        block('ANDROID · CHROME', '우측 상단 ⋮ 메뉴를 탭', '"앱 설치" 선택')}
    </div>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `cd 4K_FE && npx tsc --noEmit`
Expected: 통과. (DemoInstall이 아직 렌더에서 호출되지 않아 unused일 수 있으나 tsc는 통과 — Task 3에서 사용.)

- [ ] **Step 3: 커밋**

```bash
cd 4K_FE && git add app/components/Tutorial.tsx
git commit -m "feat(tutorial): DemoInstall — 플랫폼 감지 홈화면 설치 안내"
```

---

## Task 3: demo 배열 연결 + 검증

**Files:**
- Modify: `4K_FE/app/components/Tutorial.tsx`

- [ ] **Step 1: demo 배열에 DemoInstall 추가**

변경 전:
```tsx
  const demo = [
    <DemoWelcome key="w" />,
    <DemoGraph key="g" />,
    <DemoFilters key="f" />,
    <DemoRandom key="r" />,
    <DemoDetail key="d" />,
  ][step];
```
변경 후:
```tsx
  const demo = [
    <DemoWelcome key="w" />,
    <DemoGraph key="g" />,
    <DemoFilters key="f" />,
    <DemoRandom key="r" />,
    <DemoDetail key="d" />,
    <DemoInstall key="i" />,
  ][step];
```

- [ ] **Step 2: 타입체크 + lint**

Run: `cd 4K_FE && npx tsc --noEmit && npm run lint 2>&1 | grep -A3 "components/Tutorial.tsx" || echo "Tutorial.tsx lint 통과"`
Expected: tsc 통과. Tutorial.tsx에 신규 lint 에러 없음.
(주의: `react/no-unstable-nested-components`를 피하려 `block`/`stepRow`는 컴포넌트가 아닌 함수 호출 패턴으로 작성했다. 만약 `react/jsx-key` 에러가 나오면 `block`/`stepRow`의 최상위 요소에 `key`가 있는지 확인 — 위 코드엔 이미 포함됨.)

- [ ] **Step 3: 프로덕션 빌드**

Run: `cd 4K_FE && npm run build`
Expected: 빌드 성공.

- [ ] **Step 4: dev 시각 확인**

Run: `cd 4K_FE && (npm run dev >/tmp/peakly-dev.log 2>&1 &) ; until grep -qE "Ready in|error" /tmp/peakly-dev.log; do sleep 0.5; done; curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/dashboard; echo " <- /dashboard"`
이후 브라우저에서 확인(필요 시 콘솔에서 `localStorage.removeItem('peakly_tutorial_done')` 후 새로고침):
- 튜토리얼이 **6스텝**으로 진행, dots **6개**, 마지막 스텝 제목 `휴대폰에 앱으로 설치하기`, 버튼 `시작하기`로 종료.
- DevTools 디바이스 토글:
  - iPhone(iOS UA) → **iOS 블록만**
  - Android UA → **Android 블록만**
  - 데스크탑(토글 끔) → **iOS·Android 둘 다**
- 1~5스텝 회귀 없음(라벨이 `/6`로 표시).

종료: `pkill -f "next dev"`

- [ ] **Step 5: 커밋**

```bash
cd 4K_FE && git add app/components/Tutorial.tsx
git commit -m "feat(tutorial): demo 배열에 DemoInstall 연결(6스텝 활성화)"
```

---

## 완료 기준 (스펙 §6 대응)

- [ ] 튜토리얼 6스텝 진행 + dots 6개 + 마지막 `시작하기` 종료
- [ ] iOS UA→iOS만 / Android UA→Android만 / 데스크탑→둘 다
- [ ] 1~5스텝 문구/동작 회귀 없음(라벨 `/6`)
- [ ] `npx tsc --noEmit` 통과, Tutorial.tsx 신규 lint 에러 없음, `npm run build` 성공
