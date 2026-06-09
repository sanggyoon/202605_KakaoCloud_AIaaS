// 매니저 '자막 데이터 수집' — BE collect를 트리거하고 NDJSON 진행 스트림을 그대로 전달.
export const dynamic = 'force-dynamic';

const BE_URL = process.env.BE_INTERNAL_URL ?? 'http://localhost:8000';

export async function POST() {
  const res = await fetch(`${BE_URL}/api/subtitles/collect`, { method: 'POST' });
  return new Response(res.body, {
    status: res.status,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
    },
  });
}
