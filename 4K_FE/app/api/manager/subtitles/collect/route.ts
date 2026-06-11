// 매니저 자막 수집 — BE 백그라운드 잡 시작(JSON 반환). 진행은 /api/manager/jobs/subtitle 폴링.
export const dynamic = 'force-dynamic';

const BE_URL = process.env.BE_INTERNAL_URL ?? 'http://localhost:8000';

export async function POST(request: Request) {
  const limit = new URL(request.url).searchParams.get('limit');
  const qs = limit ? `?limit=${encodeURIComponent(limit)}` : '';
  const res = await fetch(`${BE_URL}/api/subtitles/collect${qs}`, { method: 'POST' });
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
