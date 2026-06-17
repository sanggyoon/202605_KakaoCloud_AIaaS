# Peakly 설치형 PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Peakly를 홈 화면에 설치해 standalone으로 실행되는 설치형 PWA로 만든다(service worker/오프라인/푸시 없음).

**Architecture:** Next.js 16 App Router 내장 규약을 사용한다 — `app/manifest.ts`가 `/manifest.webmanifest`와 `<link rel="manifest">`를 자동 생성한다. 아이콘 PNG는 기존 `public/peakly-gradient-bg.svg`에서 `sharp`로 1회 생성해 `public/`에 커밋한다. `app/layout.tsx`에 viewport theme-color와 iOS appleWebApp 메타를 추가한다.

**Tech Stack:** Next.js 16.2.5(App Router, Turbopack), `sharp`(아이콘 생성, Next 번들·검증됨). 테스트 러너 없음 → 검증은 `node`(아이콘 산출), `npx tsc --noEmit`, `npm run lint`, `npm run build`, `/manifest.webmanifest` 응답 확인.

**스펙 참조:** `docs/superpowers/specs/2026-06-17-pwa-installable-design.md`

**작업 디렉터리:** 모든 명령은 `4K_FE/`에서 실행한다(`cd 4K_FE`). 셸 cwd가 리셋될 수 있으니 각 Bash 단계는 절대경로 `cd`로 시작한다.

---

## 사전 확인

- [ ] **Step 0: Next.js 가이드 확인 (AGENTS.md 준수)**

이 프로젝트는 커스텀 Next.js다. PWA 작업은 내장 규약만 사용하므로 다음 문서를 참고한다.

Run: `cd 4K_FE && cat node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md | head -90`
Expected: manifest는 `app/manifest.ts`로, 설치 가능 요건은 manifest + 192/512 아이콘 + HTTPS(§1, §6). service worker 없이 설치형 가능.

---

## Task 1: 아이콘 생성 스크립트 + PNG 산출

**Files:**
- Create: `4K_FE/scripts/gen-pwa-icons.mjs`
- Create(산출): `4K_FE/public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`

- [ ] **Step 1: 아이콘 생성 스크립트 작성**

`4K_FE/scripts/gen-pwa-icons.mjs` 생성:

```js
// PWA 아이콘 생성기 — public/peakly-gradient-bg.svg → PNG 4종.
// 실행: node scripts/gen-pwa-icons.mjs  (4K_FE 디렉터리에서)
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
const svg = readFileSync(join(pub, 'peakly-gradient-bg.svg'));

async function render(size, out) {
  await sharp(svg).resize(size, size).png().toFile(join(pub, out));
  console.log('written', out);
}

async function renderMaskable(out) {
  // 512 캔버스를 앱 배경색으로 채우고 로고를 80%(410px) 중앙 합성 → maskable 안전영역 확보
  const logo = await sharp(svg).resize(410, 410).png().toBuffer();
  await sharp({
    create: { width: 512, height: 512, channels: 4, background: '#0f0a24' },
  })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(join(pub, out));
  console.log('written', out);
}

await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(180, 'apple-touch-icon.png');
await renderMaskable('icon-maskable-512.png');
console.log('done');
```

- [ ] **Step 2: 스크립트 실행해 PNG 생성**

Run: `cd 4K_FE && node scripts/gen-pwa-icons.mjs`
Expected 출력:
```
written icon-192.png
written icon-512.png
written apple-touch-icon.png
written icon-maskable-512.png
done
```

- [ ] **Step 3: 산출물 확인**

Run: `cd 4K_FE && node -e "const s=require('sharp');for(const f of ['icon-192','icon-512','icon-maskable-512','apple-touch-icon']){s('public/'+f+'.png').metadata().then(m=>console.log(f,m.width+'x'+m.height,m.format))}"`
Expected: `icon-192 192x192 png`, `icon-512 512x512 png`, `icon-maskable-512 512x512 png`, `apple-touch-icon 180x180 png` (순서는 비동기라 섞일 수 있음).

- [ ] **Step 4: 커밋**

```bash
cd 4K_FE && git add scripts/gen-pwa-icons.mjs public/icon-192.png public/icon-512.png public/icon-maskable-512.png public/apple-touch-icon.png
git commit -m "feat(pwa): 아이콘 생성 스크립트 + PNG 4종(192/512/maskable/apple)"
```

---

## Task 2: `app/manifest.ts`

**Files:**
- Create: `4K_FE/app/manifest.ts`

- [ ] **Step 1: manifest 작성**

`4K_FE/app/manifest.ts` 생성:

```ts
import type { MetadataRoute } from 'next';

// 웹 앱 manifest — Next가 /manifest.webmanifest와 <link rel="manifest">를 자동 생성.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Peakly — Climax-based Movie Recommendation',
    short_name: 'Peakly',
    description: '클라이맥스 그래프를 분석해 비슷한 영화를 추천하는 서비스',
    start_url: '/',
    display: 'standalone',
    background_color: '#08090d',
    theme_color: '#08090d',
    lang: 'ko',
    categories: ['entertainment'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
```

- [ ] **Step 2: 타입체크**

Run: `cd 4K_FE && npx tsc --noEmit`
Expected: 통과(출력 없음). `MetadataRoute.Manifest` 타입이 맞아야 함.

- [ ] **Step 3: 커밋**

```bash
cd 4K_FE && git add app/manifest.ts
git commit -m "feat(pwa): app/manifest.ts (standalone + 아이콘 매니페스트)"
```

---

## Task 3: `app/layout.tsx` — viewport theme-color + iOS 메타

**Files:**
- Modify: `4K_FE/app/layout.tsx`

- [ ] **Step 1: import에 Viewport 추가**

변경 전:
```ts
import type { Metadata } from "next";
```
변경 후:
```ts
import type { Metadata, Viewport } from "next";
```

- [ ] **Step 2: metadata 확장 + viewport export 추가**

변경 전:
```ts
export const metadata: Metadata = {
  title: "Peakly — Climax-based Movie Recommendation",
  description: "클라이맥스 그래프를 분석해 비슷한 영화를 추천하는 서비스",
  icons: { icon: "/peakly-black-bg.svg" },
};
```
변경 후:
```ts
export const metadata: Metadata = {
  title: "Peakly — Climax-based Movie Recommendation",
  description: "클라이맥스 그래프를 분석해 비슷한 영화를 추천하는 서비스",
  icons: { icon: "/peakly-black-bg.svg", apple: "/apple-touch-icon.png" },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Peakly",
  },
};

// theme-color는 metadata가 아닌 viewport로 지정(Next 16 권장).
export const viewport: Viewport = {
  themeColor: "#08090d",
};
```

- [ ] **Step 3: 타입체크 + lint**

Run: `cd 4K_FE && npx tsc --noEmit && npm run lint 2>&1 | grep -A2 "layout.tsx" || echo "layout.tsx lint 통과"`
Expected: tsc 통과. layout.tsx에 신규 lint 에러 없음.
(주의: 저장소에 기존 lint 에러들이 있으나 본 작업과 무관. layout.tsx만 깨끗하면 됨.)

- [ ] **Step 4: 커밋**

```bash
cd 4K_FE && git add app/layout.tsx
git commit -m "feat(pwa): layout viewport theme-color + iOS appleWebApp/apple 아이콘"
```

---

## Task 4: 빌드 + manifest/메타 검증

**Files:** 없음(검증만)

- [ ] **Step 1: 프로덕션 빌드**

Run: `cd 4K_FE && npm run build`
Expected: 빌드 성공. 라우트 목록에 `○ /manifest.webmanifest`(또는 manifest 라우트)가 포함됨.

- [ ] **Step 2: dev에서 manifest 응답 확인**

Run (백그라운드 dev 서버):
```bash
cd 4K_FE && (npm run dev >/tmp/peakly-dev.log 2>&1 &) ; \
until grep -qE "Ready in|error" /tmp/peakly-dev.log; do sleep 0.5; done; \
echo "--- manifest ---"; curl -s http://localhost:3000/manifest.webmanifest; echo; \
echo "--- head 링크/메타 ---"; curl -s http://localhost:3000/ | grep -oiE "<link rel=\"manifest\"[^>]*>|name=\"theme-color\"[^>]*>|apple-mobile-web-app[^>]*>|rel=\"apple-touch-icon\"[^>]*>" | head
```
Expected:
- manifest JSON에 `"name":"Peakly — ...","short_name":"Peakly","display":"standalone"`와 icons 3개 포함.
- head에 `<link rel="manifest" ...>`, `theme-color` 메타, `apple-mobile-web-app-capable`, apple-touch-icon 링크가 보임.

- [ ] **Step 3: dev 서버 종료**

Run: `pkill -f "next dev"; echo stopped`

- [ ] **Step 4: (코드 변경 없으면 커밋 생략)**

빌드/검증만 수행. 변경 없으면 커밋하지 않는다.

---

## 완료 기준 (스펙 §6 대응)

- [ ] `npm run build` 성공
- [ ] `/manifest.webmanifest`가 name/short_name/`display:standalone`/icons(192/512/maskable) 포함해 응답
- [ ] HTML head에 `<link rel="manifest">`, `theme-color`, apple 메타 존재
- [ ] 아이콘 PNG 4종이 `public/`에 존재하고 크기가 192/512/512/180
- [ ] `npx tsc --noEmit` 통과, 변경 파일 신규 lint 에러 없음
- [ ] (수동/프로덕션) Chrome DevTools → Application → Manifest 에러 없음 + Installable, iOS 홈 화면 추가 시 standalone 실행

## 참고: 수동 확인(배포 후)

- 설치 가능 판정은 **HTTPS 필요**. 로컬 `http://localhost`는 Chrome이 설치 허용하지만 iOS 실기기는 프로덕션(HTTPS `peakly.art`)에서 확인.
- DevTools → Application → Manifest 패널에서 아이콘/필드/Installability 경고를 최종 확인.
