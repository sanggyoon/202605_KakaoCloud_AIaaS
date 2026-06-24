// agami CAPTCHA 서버 검증 — 테스트 도입(비차단). 서버 전용.
// AGAMI_SECRET 미설정(로컬 dev) 시 검증 스킵(통과). 검증 실패/오류 시 false(알림용).
// SECURITY(의도됨): 이 함수는 통과 여부만 돌려줄 뿐, 호출부(로그인 라우트)는 결과로 로그인을
// 차단하지 않는다(비차단·테스트). 따라서 false(실패)가 곧 거부를 의미하지 않음 — 설계상 의도.
const AGAMI_SECRET = process.env.AGAMI_SECRET || '';
const SITEVERIFY_URL = 'https://agami-captcha.cloud/captcha/v1/siteverify';

export async function verifyCaptcha(token: string): Promise<boolean> {
  if (!AGAMI_SECRET) return true; // dev: 검증 스킵
  if (!token) return false;
  try {
    // agami siteverify 는 form-urlencoded(secret, token)를 받는다.
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: AGAMI_SECRET, token }).toString(),
      cache: 'no-store',
    });
    if (!res.ok) return false;
    // 성공 응답: {"success":true,"verdict":"human",...}
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false; // 네트워크/파싱 오류 → 실패(비차단, 알림만)
  }
}
