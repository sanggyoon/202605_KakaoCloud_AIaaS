# 매니저 로그인 CAPTCHA (agami, 테스트 도입·비차단) 설계

작성일: 2026-06-24
상태: 설계 승인됨

## 목적

매니저 로그인에 agami CAPTCHA를 **부가 검증**으로 도입(테스트 단계). 사람 여부를 관찰하되,
현 단계에서는 **로그인 차단에 사용하지 않는다**. 캡챠 성공/실패와 무관하게 매니저 페이지로
진입하며, **실패한 경우에만 사용자에게 알림(alert)** 한다.

## 범위

- 포함: 매니저 **로그인 페이지**(`/login`)에 agami 위젯 + 로그인 라우트에서 토큰 서버검증(비차단).
- 제외: 캡챠로 로그인/접근 차단, 매니저 외 다른 페이지, 봇 차단 정책. (기존 ID/비밀번호가 게이트.)

## 배경 (현재 흐름)

- `4K_FE/app/login/page.tsx` (클라이언트) → `POST /api/manager/auth/login {id, password}`.
- `4K_FE/app/api/manager/auth/login/route.ts` → `verifyCredentials` → 세션 쿠키 발급.
- 자격증명/세션은 `4K_FE/app/lib/auth.ts` (env 기반, fail-closed) — **변경하지 않음**.

## 결정 사항

| 항목 | 결정 |
|---|---|
| 캡챠 성격 | **비차단(test)** — 결과 무관 매니저 진입, 실패 시 alert |
| 게이트 | 기존 **ID/비밀번호** 유지(캡챠는 게이트 아님) |
| 위젯 | agami `loader.js` + `div.agami-captcha[data-sitekey]`, 콜백 `onCaptchaToken`/`onCaptchaError` |
| 서버검증 | `POST https://agami-captcha.cloud/captcha/v1/siteverify`, body `{"secret","token"}` |
| 성공판정 | HTTP 2xx + 응답에 `error` 키 없음 (+ `success !== false`) → passed, 그 외 failed |
| env | `NEXT_PUBLIC_AGAMI_SITEKEY`(공개) / `AGAMI_SECRET`(서버) |
| dev 정책 | `AGAMI_SECRET` 미설정 시 검증 건너뜀 → passed(알림 없음), 위젯은 SITEKEY 있을 때만 렌더 |
| 브랜치 | `main` → `feat/manager-captcha` |

## 검증 API 계약 (agami siteverify)

- 요청: `POST https://agami-captcha.cloud/captcha/v1/siteverify`
  - `Content-Type: application/json`
  - body: `{"secret": "<AGAMI_SECRET>", "token": "<captchaToken>"}`
- 실패 응답(예): `{"error":{"code":"validation_error","message":"...","errors":[...],"request_id":"..."}}`
- 성공 응답: 정확한 필드는 실제 통과 응답으로 확정. 판정은 **방어적** —
  `res.ok && !json.error && json.success !== false` 이면 통과.

## 상세 설계

### 흐름
```
[로그인 페이지]
  loader.js 로드 → 위젯 렌더(data-sitekey=NEXT_PUBLIC_AGAMI_SITEKEY)
  사용자 챌린지 → onCaptchaToken(token) → state 저장 / onCaptchaError → state 'error'
  제출: POST /api/manager/auth/login { id, password, captchaToken }

[로그인 라우트(server)]
  verifyCredentials(id,password)  ── 실패 → 401 (기존)
       └ 성공 →
            captcha = AGAMI_SECRET 없음 ? 'passed'
                    : (await verifyCaptcha(captchaToken)) ? 'passed' : 'failed'
            세션 쿠키 발급(기존)
            200 { ok:true, captcha }

[클라이언트]
  200 수신 → captcha==='failed' 이면 alert('캡챠 인증에 실패했습니다. (테스트)')
           → 항상 /manager (또는 next) 로 router.replace
```

### 컴포넌트
- **신규 `4K_FE/app/lib/captcha.ts`** (서버 전용)
  - `verifyCaptcha(token: string): Promise<boolean>`
  - `AGAMI_SECRET` 미설정 → `true`(스킵). 토큰 빈 값 → `false`.
  - siteverify POST → 위 판정. 네트워크/예외 → `false`(테스트라 비차단, 알림만).
- **수정 `4K_FE/app/login/page.tsx`** (클라이언트)
  - `loader.js`를 `next/script` 또는 동적 주입으로 로드.
  - `window.onCaptchaToken` / `window.onCaptchaError`를 `useEffect`에서 등록(언마운트 시 정리).
  - 위젯 `div`는 `NEXT_PUBLIC_AGAMI_SITEKEY` 있을 때만 렌더.
  - 제출 바디에 `captchaToken` 포함(없으면 빈 문자열). 로그인 버튼 비활성화 조건은 **기존 그대로**(캡챠 없이도 제출 가능).
  - 200 응답의 `captcha==='failed'` → `alert(...)` 후 리다이렉트.
- **수정 `4K_FE/app/api/manager/auth/login/route.ts`** (서버)
  - body에서 `captchaToken` 파싱.
  - `verifyCredentials` 성공 후 캡챠 판정 → 응답에 `captcha: 'passed' | 'failed'` 포함. 캡챠로 401 내지 않음.

### 에러 처리
- 토큰 없음/검증 실패/검증서버 오류 → `'failed'`(알림). **리다이렉트는 항상 진행.**
- 자격증명 실패 → 기존대로 401 + 페이지 에러 표시(캡챠 무관).

## env

| 변수 | 노출 | 값 |
|---|---|---|
| `NEXT_PUBLIC_AGAMI_SITEKEY` | 공개(빌드타임 inline) | `agami_site_f2b79bd56427599514155ea5c018c175` |
| `AGAMI_SECRET` | 서버 전용 | `agami_secret_...`(노출 OK, 회전 안 함) |

- 배포(k8s) 시 `AGAMI_SECRET`은 frontend-secrets에, `NEXT_PUBLIC_AGAMI_SITEKEY`는 빌드 인자/ env로.

## 검증

- `AGAMI_SECRET` 미설정 로컬: 위젯 미렌더(또는 SITEKEY만 설정 시 렌더), 캡챠 스킵 → 로그인 정상.
- SITEKEY+SECRET 설정: 위젯 표시 → 통과 시 alert 없이 매니저 진입 / 실패(또는 미해결) 시 alert 후 매니저 진입.
- 자격증명 오류 시 기존대로 401(캡챠 영향 없음).
- `npm run build`/`tsc` 통과.

## 범위 밖 (YAGNI)

- 캡챠 기반 접근 차단/레이트리밋, 봇 스코어 정책 — 테스트 이후 별도.
- 매니저 외 폼(공개 페이지)에 캡챠 적용.
