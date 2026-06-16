const BE_URL = process.env.BE_INTERNAL_URL ?? 'http://localhost:8000';

export async function GET(request: Request) {
  const qs = new URL(request.url).searchParams.toString();
  const res = await fetch(`${BE_URL}/api/visits/range?${qs}`, { cache: 'no-store' });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
