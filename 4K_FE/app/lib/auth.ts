// 매니저 페이지 인증 — env로 ID/비밀번호 관리. 서버 전용(node:crypto 사용).
import crypto from 'node:crypto';

// 세션 쿠키 이름
export const SESSION_COOKIE = 'manager_session';
// 세션 유효 시간 (초) — 8시간
export const SESSION_MAX_AGE = 60 * 60 * 8;

// 자격증명/시크릿은 env에서 관리.
const IS_PROD = process.env.NODE_ENV === 'production';
// 로컬 개발 편의 기본값은 비운영에서만 사용. 운영(NODE_ENV=production)에서 미설정이면
// 아래 MISCONFIGURED로 인증을 전면 거부(fail-closed) — 기본 시크릿으로 우회 불가.
const MANAGER_ID = process.env.MANAGER_ID ?? (IS_PROD ? '' : 'admin');
const MANAGER_PASSWORD = process.env.MANAGER_PASSWORD ?? (IS_PROD ? '' : 'admin');
const SESSION_SECRET =
  process.env.MANAGER_SESSION_SECRET ?? (IS_PROD ? '' : 'dev-only-insecure-secret');

// 운영에서 비밀번호/세션 시크릿이 비어 있으면 설정 오류 → 인증 자체를 막는다.
// (공개 사이트는 그대로 동작, 매니저만 잠김)
const MISCONFIGURED = IS_PROD && (!process.env.MANAGER_PASSWORD || !process.env.MANAGER_SESSION_SECRET);
if (MISCONFIGURED) {
  console.error(
    '[auth] MANAGER_PASSWORD/MANAGER_SESSION_SECRET 미설정 — 매니저 인증 비활성화(fail-closed).',
  );
}

// 입력한 ID/비밀번호가 env 값과 일치하는지 검증. 설정 오류 시 항상 거부.
export function verifyCredentials(id: string, password: string): boolean {
  if (MISCONFIGURED) return false;
  return id === MANAGER_ID && password === MANAGER_PASSWORD;
}

// payload를 HMAC 서명 (base64url)
function sign(payload: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
}

// 만료시각(exp)을 담아 서명한 세션 토큰. 형식: <payload>.<sig>
// → 토큰마다 exp가 박혀 8시간 후 무효, 변조 시 서명 불일치로 거부.
export function sessionToken(): string {
  const exp = Date.now() + SESSION_MAX_AGE * 1000;
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

// 토큰 검증: 서명 상수시간 비교 + 만료 확인. 설정 오류 시 항상 거부(위조 차단).
export function isValidSession(token: string | undefined | null): boolean {
  if (MISCONFIGURED) return false;
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { exp?: number };
    return typeof exp === 'number' && Date.now() < exp;
  } catch {
    return false;
  }
}
