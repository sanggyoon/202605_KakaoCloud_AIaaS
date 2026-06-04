import { cookies } from 'next/headers';
import { verifyCredentials, sessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from '@/app/lib/auth';

export async function POST(request: Request) {
  let body: { id?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ detail: '잘못된 요청입니다.' }, { status: 400 });
  }

  if (!verifyCredentials(body.id ?? '', body.password ?? '')) {
    return Response.json({ detail: 'ID 또는 비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, sessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE,
  });

  return Response.json({ ok: true });
}
