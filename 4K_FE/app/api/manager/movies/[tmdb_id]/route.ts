const BE_URL = process.env.BE_INTERNAL_URL ?? 'http://localhost:8000';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tmdb_id: string }> }
) {
  const { tmdb_id } = await params;
  const res = await fetch(`${BE_URL}/api/movies/${tmdb_id}/detail`, { cache: 'no-store' });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ tmdb_id: string }> }
) {
  const { tmdb_id } = await params;
  const body = await request.json();
  const res = await fetch(`${BE_URL}/api/movies/${tmdb_id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ tmdb_id: string }> }
) {
  const { tmdb_id } = await params;
  const res = await fetch(`${BE_URL}/api/movies/${tmdb_id}`, { method: 'DELETE' });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
