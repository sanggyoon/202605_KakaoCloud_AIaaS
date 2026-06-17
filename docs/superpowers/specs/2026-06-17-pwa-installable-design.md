# Peakly 설치형 PWA — 설계 문서

- 날짜: 2026-06-17
- 대상: `4K_FE/` (Next.js 16.2.5, App Router, Turbopack)
- 범위: **설치형(Installable) PWA만**. service worker / 오프라인 / 푸시 알림 없음.

## 1. 목표와 배경

Peakly를 **홈 화면에 설치해 네이티브 앱처럼 standalone(주소창 없는 전체화면)으로 실행**되게 한다. 그동안 다듬은 모바일 UI가 standalone에서 제대로 보이도록 하는 것이 목적.

현재 상태:
- manifest / service worker / PWA 의존성 **전혀 없음**.
- `app/layout.tsx`에 기본 `metadata`(title/description/icon SVG)만 존재.
- 빌드 도구가 **Turbopack** → 공식 가이드의 오프라인 플러그인 **Serwist(webpack 전용)는 사용 불가**. 이번 범위는 service worker가 없으므로 무관.
- 프로덕션은 HTTPS(`peakly.art`) → 설치 가능 요건의 HTTPS 충족.

설치 가능(Add to Home Screen) 요건은 **유효한 manifest + 192/512 아이콘 + HTTPS**이며 service worker는 불필요하다. (Next.js 16 공식 PWA 가이드 §1, §6 기준)

## 2. 변경 파일 개요

| 파일 | 작업 | 책임 |
|---|---|---|
| `4K_FE/app/manifest.ts` | 신규 | 웹 앱 manifest 생성(이름/표시모드/색/아이콘). Next가 `/manifest.webmanifest` + `<link rel="manifest">` 자동 처리 |
| `4K_FE/public/icon-192.png` | 신규 | 설치 아이콘 192 (purpose any) |
| `4K_FE/public/icon-512.png` | 신규 | 설치 아이콘 512 (purpose any) |
| `4K_FE/public/icon-maskable-512.png` | 신규 | maskable 아이콘 512 (안전영역 패딩 포함) |
| `4K_FE/public/apple-touch-icon.png` | 신규 | iOS 홈 화면 아이콘 180 |
| `4K_FE/app/layout.tsx` | 수정 | `viewport.themeColor`, `metadata.appleWebApp`, apple 아이콘 연결 |
| `4K_FE/scripts/gen-pwa-icons.mjs` | 신규 | 아이콘 생성 1회용 스크립트(재현 가능하게 보관) |

## 3. `app/manifest.ts` (신규)

`MetadataRoute.Manifest`를 반환한다.

```ts
import type { MetadataRoute } from 'next';

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

- `background_color`/`theme_color`는 앱 배경(`--bg` = `#08090d`)과 일치시켜 스플래시·툴바를 매끄럽게.
- `orientation`은 지정하지 않음(데스크탑 설치도 고려, 세로 강제 안 함).

## 4. 아이콘 생성 (`scripts/gen-pwa-icons.mjs`)

소스: `public/peakly-gradient-bg.svg` (512×512 풀블리드 그라데이션 로고). 변환: **`sharp`**(Next 번들, 확인됨). 시스템 도구(rsvg/ImageMagick)는 없음.

생성물:
- `icon-192.png` — SVG를 192로 렌더(풀블리드).
- `icon-512.png` — SVG를 512로 렌더(풀블리드).
- `apple-touch-icon.png` — SVG를 180으로 렌더(풀블리드; iOS가 자체 라운딩).
- `icon-maskable-512.png` — 512 캔버스를 `#0f0a24`로 채우고 SVG를 **410px(약 80%) 중앙 합성** → maskable 안전영역(중앙 80%) 확보.

스크립트는 `4K_FE/`에서 `node scripts/gen-pwa-icons.mjs`로 실행하며, 결과 PNG를 `public/`에 쓰고 커밋한다. 스크립트도 함께 보관해 재생성 가능.

## 5. `app/layout.tsx` (수정)

- `Viewport` import 추가, `export const viewport: Viewport = { themeColor: '#08090d' }`.
  (metadata의 `themeColor`는 deprecated → viewport export 사용.)
- `metadata`에 다음 추가/수정:
  - `appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Peakly' }` (iOS standalone + 상태바).
  - `icons: { icon: '/peakly-black-bg.svg', apple: '/apple-touch-icon.png' }` (기존 icon 유지 + apple 추가).
- 기존 title/description/font/`<html>`/`<body>` 구조는 그대로.
- `manifest` 링크는 `app/manifest.ts` 존재만으로 Next가 자동 주입 → 수동 `<link>` 불필요.

## 6. 검증 기준

- `cd 4K_FE && npm run build` 성공.
- 빌드 산출물/dev에서 `/manifest.webmanifest` 200 응답 + JSON에 name/short_name/display/icons 포함.
- 페이지 HTML `<head>`에 `<link rel="manifest">`, `theme-color`, apple 메타 존재.
- Chrome DevTools → Application → Manifest: 에러 없음, 아이콘(192/512/maskable) 인식, "Installable" 표시.
- iOS Safari: 공유 → 홈 화면에 추가 시 Peakly 아이콘 + standalone 실행(주소창 없음).
- `npx tsc --noEmit`, `npm run lint`(변경 파일 신규 에러 없음) 통과.

## 7. 범위 밖 (Non-goals)

- service worker / 오프라인 캐싱 / 푸시 알림(VAPID·web-push) — 필요 시 본 설치형 위에 별도 작업으로 추가.
- 영화 데이터 동작 변경 없음(기존 실시간 Supabase fetch 유지).
- 커스텀 설치 버튼(`beforeinstallprompt`) — iOS 미지원이라 도입하지 않음. 브라우저 기본 설치 UI 사용.
