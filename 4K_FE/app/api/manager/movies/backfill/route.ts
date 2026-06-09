// 매니저 '신규 100개 추가' — BE backfill을 트리거하고 NDJSON 진행 스트림을 그대로 전달.
export const dynamic = 'force-dynamic';

const BE_URL = process.env.BE_INTERNAL_URL ?? 'http://localhost:8000';

export async function POST() {
  const res = await fetch(`${BE_URL}/api/movies/backfill`, { method: 'POST' });
  return new Response(res.body, {
    status: res.status,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
    },
  });
}
