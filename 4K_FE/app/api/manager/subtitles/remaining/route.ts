// 매니저 '자막 데이터 수집' 입력칸 최대치 — BE remaining 카운트 프록시.
const BE_URL = process.env.BE_INTERNAL_URL ?? 'http://localhost:8000';

export async function GET() {
  const res = await fetch(`${BE_URL}/api/subtitles/remaining`, { cache: 'no-store' });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
