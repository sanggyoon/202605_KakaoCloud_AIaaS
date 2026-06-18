# 모바일 클라이맥스 그래프 스크럽 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모바일에서 클라이맥스 그래프 높이를 210px로 줄이고, 그래프 하단에 스크럽 슬라이더를 추가해 드래그/탭하면 데스크탑 호버와 동일한 정보(진행도/피크/분위기)가 그래프를 따라 이동하고 손을 떼면 잠시 후 페이드아웃되게 한다.

**Architecture:** `ClimaxGraph`에 `matchMedia` 기반 `isMobile` 감지를 넣어 모바일이면 높이 210·하단 슬라이더를 렌더한다. 기존 `hover` 인덱스 상태를 슬라이더의 Pointer 이벤트가 제어하고, 손을 떼면 타이머(1.2s 유지 + 0.4s 페이드)로 정보를 지운다. 데스크탑은 기존 호버 그대로. `DetailOverlay`의 그래프 컨테이너 높이만 반응형으로 바꾼다.

**Tech Stack:** Next.js 16.2.5 App Router, React(클라이언트 컴포넌트), Pointer Events, SVG, 인라인 스타일.

## Global Constraints

- 작업 디렉토리: `4K_FE/`. import alias: `@/*` → `./*`.
- 코드 작성 전 `4K_FE/node_modules/next/dist/docs/` 확인 (커스텀 Next — `AGENTS.md`).
- 테스트 러너 없음 → 검증 = `npx tsc --noEmit` + `npx eslint <변경파일>`(변경 파일만 클린; 기존 pre-existing 에러 제외) + `npm run build` + dev 모바일 뷰포트 수동 확인.
- 데스크탑(>639px) 동작·외형은 **변경 없음**: 호버, 높이 380px 유지.
- 모바일 기준: `matchMedia('(max-width: 639px)')`. 모바일 그래프 높이 **210px**.
- 페이드: 손 뗌 후 **1.2s 유지 + 0.4s 페이드아웃**. 재터치 시 즉시 복귀.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- 작업 브랜치: `feat/mobile-graph-scrubber` (이미 생성됨).

## File Structure

- **Modify(전면 갱신)** `4K_FE/app/components/ClimaxGraph.tsx` — isMobile 감지, 반응형 높이(210/380), 그래프를 내부 div로 분리, 호버/마커/툴팁을 페이드 래퍼로 감싸기, 모바일 하단 스크럽 슬라이더 + Pointer 핸들러 + 페이드 타이머.
- **Modify** `4K_FE/app/components/DetailOverlay.tsx` — 그래프 컨테이너 고정 높이 380 → 그래프 렌더 시 `auto`.

---

### Task 1: ClimaxGraph — 반응형 높이 + 스크럽 슬라이더 + 페이드

**Files:**
- Modify(전면 갱신): `4K_FE/app/components/ClimaxGraph.tsx`

**Interfaces:**
- Consumes: `toDisplayScale`(`@/app/lib/climax`), `valenceGradientStops`/`valenceToUnit`/`valenceColorAt`(`@/app/lib/color`), `catmullRomPath`(`@/app/lib/svgPath`). props `{ data: number[]; valence?: number[]; height?: number }` 유지.
- Produces: 동일 props의 `ClimaxGraph`(외부 인터페이스 불변). 내부에 모바일 스크럽 UI 추가.

- [ ] **Step 1: 파일 전면 교체**

`4K_FE/app/components/ClimaxGraph.tsx` 전체를 아래로 교체:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { toDisplayScale } from '@/app/lib/climax';
import { valenceGradientStops, valenceToUnit, valenceColorAt } from '@/app/lib/color';
import { catmullRomPath } from '@/app/lib/svgPath';

// arousal=높이, valence=색(있을 때).
// 데스크탑: 호버로 십자선+툴팁. 모바일: 높이 축소 + 하단 스크럽 슬라이더(동일 정보).
interface ClimaxGraphProps {
  data: number[];        // arousal
  valence?: number[];    // valence (색)
  height?: number;
}

export default function ClimaxGraph({ data, valence, height = 380 }: ClimaxGraphProps) {
  // 모바일 감지 — 모바일은 높이를 줄이고 하단 슬라이더로 스크럽한다.
  // ClimaxGraph는 vector 로드 후 클라이언트에서만 마운트되므로 초기값을 window에서
  // 바로 읽어도 안전(SSR/하이드레이션 불일치 없음). effect는 변경 구독만 — setState를
  // effect 본문에서 동기 호출하지 않아 set-state-in-effect 규칙에 걸리지 않는다.
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const W = 600;
  const H = isMobile ? 210 : height;
  const padX = 8;
  const padY = isMobile ? 40 : 64;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const toY = (val: number) => padY + innerH - ((val - min) / range) * innerH;
  const toX = (i: number) => padX + (i / (data.length - 1)) * innerW;

  const pts = data.map((val, i) => [toX(i), toY(val)]);
  const d = catmullRomPath(pts);
  const fillD = `${d} L${padX + innerW},${H} L${padX},${H} Z`;

  const stops = valence ? valenceGradientStops(valence) : [];
  const vUnit = valence ? valenceToUnit(valence) : [];
  const stroke = stops.length ? 'url(#cgValence)' : 'var(--accent)';

  const graphRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [thumbRatio, setThumbRatio] = useState(0);
  const [fading, setFading] = useState(false);
  const [drawn, setDrawn] = useState(false);

  // 데스크탑 호버 (모바일에선 슬라이더가 제어하므로 미사용)
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = graphRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover(Math.round(fx * (data.length - 1)));
  };

  // 모바일 스크럽: 슬라이더 트랙 기준 위치 → scene 인덱스. 손 뗌 후 1.2s 유지 + 0.4s 페이드.
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragging = useRef(false);
  const clearTimers = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    hideTimer.current = null;
    fadeTimer.current = null;
  };
  useEffect(() => () => clearTimers(), []);

  const scrubTo = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setThumbRatio(f);
    setHover(Math.round(f * (data.length - 1)));
  };
  const onScrubDown = (e: React.PointerEvent<HTMLDivElement>) => {
    clearTimers();
    setFading(false);
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    scrubTo(e.clientX);
  };
  const onScrubMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    scrubTo(e.clientX);
  };
  const onScrubUp = () => {
    dragging.current = false;
    clearTimers();
    hideTimer.current = setTimeout(() => {
      setFading(true);
      fadeTimer.current = setTimeout(() => {
        setHover(null);
        setFading(false);
      }, 400);
    }, 1200);
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
    <div style={{ width: '100%' }}>
      <div
        ref={graphRef}
        onMouseMove={isMobile ? undefined : onMove}
        onMouseLeave={isMobile ? undefined : () => setHover(null)}
        style={{ position: 'relative', width: '100%', height: H, cursor: isMobile ? 'default' : 'crosshair' }}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className={drawn ? undefined : 'cg-draw'}
          onAnimationEnd={() => setDrawn(true)}
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
            vectorEffect="non-scaling-stroke"
            filter="url(#cgGlow)"
          />
        </svg>

        {hover !== null && (
          <div
            style={{
              position: 'absolute', inset: 0, pointerEvents: 'none',
              opacity: fading ? 0 : 1, transition: 'opacity 0.4s ease',
            }}
          >
            <div style={{ position: 'absolute', left: `${hx}%`, top: 0, bottom: 0, width: 1, background: 'rgba(123,97,255,0.45)' }} />
            <div style={{ position: 'absolute', top: `${hy}%`, left: 0, right: 0, height: 1, background: 'rgba(123,97,255,0.45)' }} />
            <div style={{ position: 'absolute', left: `${hx}%`, top: `${hy}%`, transform: 'translate(-50%, -50%)', width: 11, height: 11, borderRadius: '50%', background: moodColor, boxShadow: `0 0 14px 4px ${moodColor}` }} />
            <div
              style={{
                position: 'absolute', left: `${tipLeft}%`, top: `${hy}%`,
                transform: tipBelow ? 'translate(-50%, 16px)' : 'translate(-50%, calc(-100% - 16px))',
                whiteSpace: 'nowrap',
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
          </div>
        )}
      </div>

      {isMobile && (
        <div
          ref={trackRef}
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          onPointerCancel={onScrubUp}
          style={{
            position: 'relative', height: 40, marginTop: 8,
            display: 'flex', alignItems: 'center',
            touchAction: 'none', cursor: 'pointer', userSelect: 'none',
          }}
        >
          <div style={{ position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.12)' }} />
          <div style={{ position: 'absolute', left: 0, width: `${thumbRatio * 100}%`, height: 4, borderRadius: 999, background: 'rgba(123,97,255,0.5)' }} />
          <div
            style={{
              position: 'absolute', left: `${thumbRatio * 100}%`, transform: 'translateX(-50%)',
              width: 18, height: 18, borderRadius: '50%',
              background: hover !== null ? moodColor : '#fff',
              boxShadow: `0 0 10px 2px ${hover !== null ? moodColor : 'rgba(255,255,255,0.45)'}`,
              border: '2px solid rgba(255,255,255,0.85)',
            }}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 타입 검사**

Run: `cd 4K_FE && npx tsc --noEmit 2>&1 | grep -i "ClimaxGraph" || echo "NO ClimaxGraph ERRORS"`
Expected: `NO ClimaxGraph ERRORS`

- [ ] **Step 3: 린트 (변경 파일)**

Run: `cd 4K_FE && npx eslint app/components/ClimaxGraph.tsx`
Expected: 출력 없음 (클린). 만약 `set-state-in-effect` 류가 나오면, 이 컴포넌트의 `useEffect`는 외부 시스템(matchMedia) 구독·타이머 정리용이라 해당 규칙 대상이 아니어야 한다 — 출력이 깨끗한지 확인.

- [ ] **Step 4: 빌드**

Run: `cd 4K_FE && npm run build 2>&1 | grep -E "Compiled successfully|Failed|Error" | head -2`
Expected: `✓ Compiled successfully`

- [ ] **Step 5: 커밋**

```bash
cd 4K_FE && git add app/components/ClimaxGraph.tsx
git commit -m "$(printf 'feat(fe): 모바일 클라이맥스 그래프 높이 축소 + 스크럽 슬라이더\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: DetailOverlay 그래프 컨테이너 높이 반응형

**Files:**
- Modify: `4K_FE/app/components/DetailOverlay.tsx`

**Interfaces:**
- Consumes: `ClimaxGraph`(Task 1) — 모바일에서 자체적으로 210px+슬라이더 높이를 차지.
- Produces: 없음(시각 변경).

- [ ] **Step 1: 컨테이너 고정 높이 → 그래프 렌더 시 auto**

`4K_FE/app/components/DetailOverlay.tsx`에서 그래프 컨테이너 `<div>`의 `height: 380,`을 아래로 교체한다(같은 style 객체 내 `marginTop: 18,` 다음 줄):

```tsx
                marginTop: 18,
                height: vectorLoading || !vector ? 380 : 'auto',
```

> 그래프가 렌더되면 컨테이너가 그래프(데스크탑 380 / 모바일 210+슬라이더)에 맞춰 높이를 잡는다. 로딩/없음 placeholder는 기존처럼 380으로 공간을 유지한다. 데스크탑은 그래프가 380이라 외형 동일.

- [ ] **Step 2: 타입 검사 + 빌드**

Run: `cd 4K_FE && npx tsc --noEmit 2>&1 | grep -i "DetailOverlay" || echo "NO DetailOverlay ERRORS"`
Expected: `NO DetailOverlay ERRORS`

Run: `cd 4K_FE && npm run build 2>&1 | grep -E "Compiled successfully|Failed" | head -1`
Expected: `✓ Compiled successfully`

- [ ] **Step 3: 린트**

Run: `cd 4K_FE && npx eslint app/components/DetailOverlay.tsx 2>&1 | grep -nE ":[0-9]+:[0-9]+" | grep -v "no-img-element" | head || echo "no new errors"`
Expected: 새 에러 없음 (기존 pre-existing 제외).

- [ ] **Step 4: 모바일/데스크탑 수동 확인 (dev)**

```bash
cd 4K_FE && npm run dev
```
- 데스크탑 폭: 영화 상세 진입 → 그래프 높이 380, 마우스 호버 시 십자선+툴팁(진행도/피크/분위기) 정상.
- 모바일 폭(devtools responsive ≤639px, 또는 실제 기기): 그래프 높이 210로 낮아짐, 하단 슬라이더 표시. 슬라이더 드래그/탭 → 마커+툴팁이 그래프를 따라 이동, 정보 일치. 손 떼면 약 1.2초 뒤 페이드아웃, 재터치 시 즉시 복귀. 페이지 스크롤이 슬라이더 드래그를 방해하지 않음(touchAction:none).

> 터치 상호작용은 시각 확인 항목이다. 자동 검증은 tsc/lint/build로 갈음하고, dev에서 위 항목을 눈으로 확인한다.

- [ ] **Step 5: 커밋**

```bash
cd 4K_FE && git add app/components/DetailOverlay.tsx
git commit -m "$(printf 'feat(fe): 상세 그래프 컨테이너 높이 반응형(모바일 축소 대응)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## 완료 후

- `superpowers:finishing-a-development-branch`로 main 머지/PR 결정.
- push 거부 시 `git fetch origin && git rebase origin/main` 후 재push.
