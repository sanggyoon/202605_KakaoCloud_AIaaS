const BE_URL = process.env.BE_INTERNAL_URL ?? 'http://localhost:8000';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const res = await fetch(`${BE_URL}/api/api-keys/${id}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  return Response.json(data, { status: res.status });
}
