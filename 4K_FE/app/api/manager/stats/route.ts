// 매니저 모니터링 통계 — BE /api/stats로 프록시.
const BE_URL = process.env.BE_INTERNAL_URL ?? 'http://localhost:8000';

export async function GET() {
  const res = await fetch(`${BE_URL}/api/stats`, { cache: 'no-store' });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
