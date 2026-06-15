const BE_URL = process.env.BE_INTERNAL_URL ?? 'http://localhost:8000';

export async function GET() {
  const res = await fetch(`${BE_URL}/api/active-model`, { cache: 'no-store' });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
