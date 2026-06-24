# 매니저 로그인 CAPTCHA (agami, 테스트·비차단) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매니저 로그인 페이지에 agami CAPTCHA를 부가(비차단)로 도입 — 결과와 무관하게 매니저 진입, 실패 시 alert.

**Architecture:** 로그인 페이지에 agami 위젯을 띄워 토큰을 받고, 로그인 POST에 동봉. 로그인 라우트는 기존 ID/비밀번호로 게이트하되, 캡챠 토큰을 서버에서 `siteverify`로 검증해 **결과만 응답에 실어** 보냄(차단 안 함). 클라이언트는 200이면 항상 매니저로 이동하고 `failed`면 alert.

**Tech Stack:** Next.js 16(App Router, next/script), TypeScript, fetch.

## Global Constraints

- 캡챠는 **비차단(test)** — 로그인 차단/게이트로 쓰지 않음. 게이트는 기존 ID/비밀번호.
- 검증 API: `POST https://agami-captcha.cloud/captcha/v1/siteverify`, JSON body `{"secret","token"}`. 실패 응답은 `{"error":{...}}`.
- 성공판정(방어적): `res.ok && !json.error && json.success !== false`.
- env: `NEXT_PUBLIC_AGAMI_SITEKEY`(공개, 빌드타임) / `AGAMI_SECRET`(서버). `AGAMI_SECRET` 미설정 시 검증 스킵(passed).
- 기존 `4K_FE/app/lib/auth.ts`는 변경하지 않음.
- 브랜치 `feat/manager-captcha`. 테스트 프레임워크 없음 → 검증은 `npx tsc --noEmit`, `npx eslint <files>`, `npm run build`, 수동.

---

## Task 1: 캡챠 서버 검증 유틸 (`lib/captcha.ts`)

**Files:**
- Create: `4K_FE/app/lib/captcha.ts`

**Interfaces:**
- Produces: `verifyCaptcha(token: string): Promise<boolean>` — 통과 true / 실패 false. `AGAMI_SECRET` 미설정 시 항상 true(스킵).

- [ ] **Step 1: captcha.ts 작성**

```ts
// agami CAPTCHA 서버 검증 — 테스트 도입(비차단). 서버 전용.
// AGAMI_SECRET 미설정(로컬 dev) 시 검증 스킵(통과). 검증 실패/오류 시 false(알림용).
const AGAMI_SECRET = process.env.AGAMI_SECRET || '';
const SITEVERIFY_URL = 'https://agami-captcha.cloud/captcha/v1/siteverify';

export async function verifyCaptcha(token: string): Promise<boolean> {
  if (!AGAMI_SECRET) return true; // dev: 검증 스킵
  if (!token) return false;
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: AGAMI_SECRET, token }),
      cache: 'no-store',
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { error?: unknown; success?: boolean };
    if (data.error) return false; // {"error":{...}} → 실패
    return data.success !== false; // 성공류 응답(방어적)
  } catch {
    return false; // 네트워크/파싱 오류 → 실패(비차단, 알림만)
  }
}
```

- [ ] **Step 2: 타입 체크 + lint**

Run: `cd 4K_FE && npx tsc --noEmit && npx eslint app/lib/captcha.ts`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add 4K_FE/app/lib/captcha.ts
git commit -m "feat(captcha): agami siteverify 서버 검증 유틸(비차단, dev 스킵)"
```

---

## Task 2: 로그인 라우트 — 캡챠 결과 응답(비차단)

**Files:**
- Modify: `4K_FE/app/api/manager/auth/login/route.ts`

**Interfaces:**
- Consumes: `verifyCaptcha(token)` from Task 1.
- Produces: 로그인 성공 응답 `{ ok: true, captcha: 'passed' | 'failed' }` (자격증명 실패는 기존 401 유지).

- [ ] **Step 1: route.ts 교체**

`4K_FE/app/api/manager/auth/login/route.ts` 전체를 아래로:

```ts
import { cookies } from 'next/headers';
import { verifyCredentials, sessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from '@/app/lib/auth';
import { verifyCaptcha } from '@/app/lib/captcha';

export async function POST(request: Request) {
  let body: { id?: string; password?: string; captchaToken?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ detail: '잘못된 요청입니다.' }, { status: 400 });
  }

  if (!verifyCredentials(body.id ?? '', body.password ?? '')) {
    return Response.json({ detail: 'ID 또는 비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }

  // 캡챠는 테스트 도입(비차단) — 결과만 응답에 싣는다.
  const captcha = (await verifyCaptcha(body.captchaToken ?? '')) ? 'passed' : 'failed';

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, sessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE,
  });

  return Response.json({ ok: true, captcha });
}
```

- [ ] **Step 2: 타입 체크 + lint**

Run: `cd 4K_FE && npx tsc --noEmit && npx eslint app/api/manager/auth/login/route.ts`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add 4K_FE/app/api/manager/auth/login/route.ts
git commit -m "feat(captcha): 로그인 라우트에 캡챠 결과 포함(비차단)"
```

---

## Task 3: 로그인 페이지 — 위젯 + 토큰 + 실패 alert

**Files:**
- Modify: `4K_FE/app/login/page.tsx`

**Interfaces:**
- Consumes: 로그인 응답 `{ ok, captcha }` from Task 2; env `NEXT_PUBLIC_AGAMI_SITEKEY`.

- [ ] **Step 1: import + Script + 전역 콜백 타입**

`4K_FE/app/login/page.tsx` 상단 import 영역을 아래로 교체(기존 `useState`/`useRouter` import 포함):

```tsx
'use client';

// 매니저 페이지 로그인 — env 기반 ID/비밀번호 인증 + agami 캡챠(테스트·비차단).
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';

const AGAMI_SITEKEY = process.env.NEXT_PUBLIC_AGAMI_SITEKEY || '';

declare global {
  interface Window {
    onCaptchaToken?: (token: string) => void;
    onCaptchaError?: (info: unknown) => void;
  }
}
```

- [ ] **Step 2: 컴포넌트에 캡챠 state + 전역 콜백 등록**

`export default function LoginPage()` 본문에서 기존 state 선언들 아래에 추가:

```tsx
  const [captchaToken, setCaptchaToken] = useState('');

  useEffect(() => {
    window.onCaptchaToken = (token: string) => setCaptchaToken(token);
    window.onCaptchaError = () => setCaptchaToken('');
    return () => {
      window.onCaptchaToken = undefined;
      window.onCaptchaError = undefined;
    };
  }, []);
```

- [ ] **Step 3: 제출 핸들러에 토큰 동봉 + 실패 alert**

`handleSubmit`의 `fetch` 바디와 성공 분기를 아래처럼 수정(`body`에 `captchaToken` 추가, 200 후 alert):

```tsx
      const res = await fetch('/api/manager/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, password, captchaToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail ?? '로그인에 실패했습니다.');
        return;
      }
      // 캡챠는 비차단(테스트) — 실패해도 진입하되 알림.
      if (data.captcha === 'failed') {
        alert('캡챠 인증에 실패했습니다. (테스트)');
      }
      const next = new URLSearchParams(window.location.search).get('next');
      router.replace(next && next.startsWith('/') ? next : '/manager');
      router.refresh();
```

- [ ] **Step 4: 위젯 + 로더 스크립트 렌더**

`<form>` 안, `{error && ...}` 블록 **위**에 위젯을 추가(사이트키 있을 때만), 그리고 컴포넌트 반환 JSX 최상위(`<div ...>` 바로 안)에 `loader.js` `Script` 추가:

위젯(폼 내부, 비밀번호 label 아래·error 위):
```tsx
        {AGAMI_SITEKEY && (
          <div
            className="agami-captcha"
            data-sitekey={AGAMI_SITEKEY}
            data-kind="flashlight"
            data-callback="onCaptchaToken"
            data-error-callback="onCaptchaError"
          />
        )}
```

로더(컨테이너 `<div>` 안 최상단, 위젯 사이트키 있을 때만):
```tsx
        {AGAMI_SITEKEY && (
          <Script src="https://agami-captcha.cloud/widget/loader.js" strategy="afterInteractive" />
        )}
```

> 로그인 버튼 비활성화 조건은 **기존 그대로**(`disabled={loading}`) — 캡챠 미해결이어도 제출 가능(비차단).

- [ ] **Step 5: 타입 체크 + lint + 빌드**

Run: `cd 4K_FE && npx tsc --noEmit && npx eslint app/login/page.tsx && npm run build`
Expected: tsc/eslint 에러 없음, 빌드 성공.

- [ ] **Step 6: 커밋**

```bash
git add 4K_FE/app/login/page.tsx
git commit -m "feat(captcha): 로그인 페이지에 agami 위젯 + 실패 alert(비차단)"
```

---

## Task 4: 문서/env 안내

**Files:**
- Modify: `4K_FE/.env.example` (있으면) 또는 신규 주석

- [ ] **Step 1: env 예시 추가**

`4K_FE/.env.example`이 있으면 아래 2줄 추가, 없으면 생성:
```
# agami CAPTCHA (테스트·비차단). 미설정 시 캡챠 스킵.
NEXT_PUBLIC_AGAMI_SITEKEY=agami_site_f2b79bd56427599514155ea5c018c175
AGAMI_SECRET=agami_secret_c9b56fb56e2742f2e78419c52a94711753ab302a737db8a578dc7e4901761e49
```

- [ ] **Step 2: 커밋**

```bash
git add 4K_FE/.env.example
git commit -m "docs(captcha): agami env 예시"
```

---

## 검증 (수동, 배포/로컬)

- 로컬 `AGAMI_SECRET` 미설정: 위젯은 `NEXT_PUBLIC_AGAMI_SITEKEY` 설정 시 렌더, 캡챠 검증 스킵 → 로그인 정상, alert 없음.
- 양쪽 설정: 위젯 표시 → 통과 시 alert 없이 `/manager` 진입 / 미해결·실패 시 `alert` 후 `/manager` 진입.
- 잘못된 ID/비밀번호: 기존대로 401 + 페이지 에러(캡챠 영향 없음).

## 자체검토 메모

- Spec 커버리지: 위젯(Task3)·서버검증(Task1)·비차단 응답(Task2)·실패 alert(Task3)·env(Task4) 모두 포함.
- auth.ts 미변경(게이트 유지). 캡챠는 응답 필드로만 전달.
