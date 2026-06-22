// 대시보드 영화 목록 조회 캐시 프록시.
// 들어온 쿼리스트링을 변형 없이 vm4(PostgREST)로 포워딩 → 필터링은 서버(DB)가 그대로 수행.
// fetch를 revalidate 3600으로 감싸 FE 파드 내 Data Cache 적용(영화는 하루 1회 갱신).
import { NextRequest, NextResponse } from 'next/server';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/app/lib/data';

export async function GET(req: NextRequest) {
  // req.nextUrl.search = "?select=...&limit=120&release_year=gte.2000&..." (인코딩 보존)
  const upstream = `${SUPABASE_URL}/rest/v1/movies${req.nextUrl.search}`;
  try {
    const res = await fetch(upstream, {
      headers: { apikey: SUPABASE_ANON_KEY },
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      return NextResponse.json([], { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([], { status: 502 });
  }
}
