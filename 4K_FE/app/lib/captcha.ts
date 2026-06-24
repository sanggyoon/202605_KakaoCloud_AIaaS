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
