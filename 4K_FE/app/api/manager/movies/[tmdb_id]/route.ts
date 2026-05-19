const BE_URL = process.env.BE_INTERNAL_URL ?? 'http://localhost:8000';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ tmdb_id: string }> }
) {
  const { tmdb_id } = await params;
  const res = await fetch(`${BE_URL}/api/movies/${tmdb_id}`, { method: 'DELETE' });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
