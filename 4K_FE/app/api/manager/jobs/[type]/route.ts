// 매니저 폴링 프록시 — BE GET /api/jobs/{type} 전달. (Next 16: params는 Promise)
export const dynamic = 'force-dynamic';

const BE_URL = process.env.BE_INTERNAL_URL ?? 'http://localhost:8000';

export async function GET(_request: Request, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const res = await fetch(`${BE_URL}/api/jobs/${encodeURIComponent(type)}`, { cache: 'no-store' });
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
