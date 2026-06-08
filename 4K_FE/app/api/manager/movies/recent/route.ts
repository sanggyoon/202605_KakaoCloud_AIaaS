const BE_URL = process.env.BE_INTERNAL_URL ?? 'http://localhost:8000';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = searchParams.get('limit') ?? '50';
  const res = await fetch(`${BE_URL}/api/movies/recent?limit=${limit}`, { cache: 'no-store' });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
