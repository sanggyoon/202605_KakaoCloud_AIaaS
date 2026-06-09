// 공개 방문 비콘 — BE /api/visits로 프록시. 인증 불필요, 실패는 조용히 처리.
const BE_URL = process.env.BE_INTERNAL_URL ?? 'http://localhost:8000';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const res = await fetch(`${BE_URL}/api/visits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return Response.json(data, { status: res.status });
  } catch {
    // 비콘 실패는 사용자 경험에 영향 주지 않음
    return Response.json({ ok: false }, { status: 200 });
  }
}
