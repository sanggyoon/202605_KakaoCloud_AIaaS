// 매니저 페이지 인증 — env로 ID/비밀번호 관리. 서버 전용(node:crypto 사용).
import crypto from 'node:crypto';

// 세션 쿠키 이름
export const SESSION_COOKIE = 'manager_session';
// 세션 유효 시간 (초) — 8시간
export const SESSION_MAX_AGE = 60 * 60 * 8;

// 자격증명/시크릿은 env에서 관리. 미설정 시 로컬 개발용 기본값(admin/admin).
const MANAGER_ID = process.env.MANAGER_ID ?? 'admin';
const MANAGER_PASSWORD = process.env.MANAGER_PASSWORD ?? 'admin';
// 세션 토큰 서명용 시크릿 — 운영에서는 반드시 env로 무작위 값 주입 권장
const SESSION_SECRET = process.env.MANAGER_SESSION_SECRET ?? 'dev-only-insecure-secret';

// 입력한 ID/비밀번호가 env 값과 일치하는지 검증
export function verifyCredentials(id: string, password: string): boolean {
  return id === MANAGER_ID && password === MANAGER_PASSWORD;
}

// ID + 시크릿 기반 HMAC 세션 토큰 (쿠키에 원문 시크릿을 담지 않음)
export function sessionToken(): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(`${MANAGER_ID}:manager`).digest('hex');
}

// 쿠키의 토큰이 유효한지 상수시간 비교로 검증
export function isValidSession(token: string | undefined | null): boolean {
  if (!token) return false;
  const expected = sessionToken();
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
