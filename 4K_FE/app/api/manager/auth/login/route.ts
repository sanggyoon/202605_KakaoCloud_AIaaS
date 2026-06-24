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
