// 매니저 페이지/관리 API 인증 게이트.
// /manager·/movie_list 페이지와 /api/manager/movies·stats API는 로그인(세션 쿠키)이 있어야 접근 가능.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, isValidSession } from '@/app/lib/auth';

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // 로그인/로그아웃은 세션 없이 허용 (그 외 모든 /api/manager/* 는 인증 필요)
  if (pathname.startsWith('/api/manager/auth')) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (isValidSession(token)) {
    return NextResponse.next();
  }

  // 관리 API는 JSON 401로 응답 (페이지 리다이렉트 대신)
  if (pathname.startsWith('/api/manager')) {
    return NextResponse.json({ detail: '인증이 필요합니다.' }, { status: 401 });
  }

  // 페이지는 로그인으로 리다이렉트 — 원래 목적지를 next 쿼리로 보존
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', pathname + search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    '/manager',
    '/manager/:path*',
    '/movie_list',
    '/movie_list/:path*',
    // 모든 매니저 API를 게이트(auth 경로는 위 함수에서 예외 허용)
    '/api/manager/:path*',
  ],
};
