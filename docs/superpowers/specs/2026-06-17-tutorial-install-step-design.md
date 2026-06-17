# 튜토리얼 "앱 설치 방법" 스텝 추가 — 설계 문서

- 날짜: 2026-06-17
- 대상: `4K_FE/app/components/Tutorial.tsx`
- 전제: 설치형 PWA가 이미 구현됨(`app/manifest.ts` 등). 이 스텝은 사용자에게 **홈 화면 설치 방법을 안내**한다.

## 1. 목표

기존 5스텝 튜토리얼에 **6번째 스텝(앱 설치 방법)**을 추가한다. 모바일 OS를 감지해 해당 플랫폼 설치법만 보여주고, 데스크탑에선 iOS·Android 둘 다 보여준다.

## 2. 스텝 구성 변경

현재 `Tutorial.tsx`의 `STEPS`는 5개이며 라벨이 `STEP N / 5`로 하드코딩, 마지막 스텝(상세 모달) action이 `시작하기`다.

변경:
- 라벨 전부 `STEP N / 5` → `STEP N / 6`.
- 기존 STEP 5(상세 모달) action `시작하기` → `다음`.
- **STEP 6 신규(마지막)** 추가:
  - `label: 'STEP 6 / 6'`
  - `title: '휴대폰에 앱으로 설치하기'`
  - `desc: '홈 화면에 추가하면 주소창 없이 앱처럼 빠르게 열려요.'`
  - `action: '시작하기'` (튜토리얼 종료 버튼)
- `demo` 배열에 `<DemoInstall key="i" />` 추가(6번째).

`isLast = step === STEPS.length - 1` 로직은 그대로 → 6번째가 자동으로 마지막(onComplete) 처리됨.

## 3. 플랫폼 감지 (`DemoInstall` 내부)

client 컴포넌트에서 `useState` + `useEffect`로 마운트 후 1회 감지한다.

```ts
type Platform = 'ios' | 'android' | 'both';
// 마운트 전 기본값 'both' (SSR 안전 + 깜빡임 최소화)
```

감지 규칙(마운트 시):
- iOS: `/iPad|iPhone|iPod/.test(navigator.userAgent)` 또는 iPadOS(`navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1`) → `'ios'`
- Android: `/Android/.test(navigator.userAgent)` → `'android'`
- 그 외(데스크탑 등): `'both'`

## 4. 데모 내용 (`DemoInstall`)

플랫폼별 "단계 블록"을 렌더한다. 각 블록 = 플랫폼 라벨 + 번호 매긴 2단계.

- **iOS 블록**
  1. Safari 하단 **공유 버튼**(⎙) 탭
  2. **홈 화면에 추가** 선택
- **Android 블록**
  1. Chrome 우측 상단 **⋮ 메뉴** 탭
  2. **앱 설치**(또는 홈 화면에 추가) 선택

표시:
- `platform === 'ios'` → iOS 블록만
- `platform === 'android'` → Android 블록만
- `platform === 'both'` → 두 블록 세로로 함께

데모 영역은 이 스텝만 **고정 높이 대신 내용에 맞춰 가변**(both일 때 2블록이라 더 높음). 데스크탑 모달은 여유가 있어 문제 없음. 카드 스타일/색은 기존 토큰 유지(accent 강조, 다크 배경).

## 5. 파일 / 책임

| 파일 | 작업 | 책임 |
|---|---|---|
| `4K_FE/app/components/Tutorial.tsx` | 수정 | `STEPS`에 6번째 추가 + 라벨 `/6` + 기존 5번 action 변경 + `demo`에 `DemoInstall` + `DemoInstall` 컴포넌트 신규 |

다른 파일 변경 없음.

## 6. 검증 기준

- `npx tsc --noEmit`, `npm run lint`(변경 파일 신규 에러 없음), `npm run build` 통과.
- dev에서 튜토리얼이 **6스텝**으로 진행, dots 6개, 마지막 버튼 `시작하기`로 종료.
- DevTools 디바이스 토글:
  - iOS(iPhone) UA → iOS 블록만
  - Android UA → Android 블록만
  - 데스크탑 → iOS·Android 둘 다
- 기존 1~5스텝 동작/문구 회귀 없음(라벨만 `/6`로).

## 7. 범위 밖 (Non-goals)

- 이미 설치된(standalone) 상태에서 스텝 숨김 — 하지 않음(YAGNI).
- `beforeinstallprompt` 기반 실제 설치 버튼 — iOS 미지원이라 안내 텍스트만.
- manifest/아이콘 등 PWA 본체 변경 — 없음(이미 구현됨).
