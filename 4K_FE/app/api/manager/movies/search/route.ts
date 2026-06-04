// BE 내부 서비스 URL — 클러스터 내부에서만 접근 가능, 브라우저에 노출되지 않음
const BE_URL = process.env.BE_INTERNAL_URL ?? 'http://localhost:8000';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') ?? '';
  const page = searchParams.get('page') ?? '1';

  const res = await fetch(
    `${BE_URL}/api/movies/search?q=${encodeURIComponent(q)}&page=${page}`,
    { cache: 'no-store' },
  );
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
