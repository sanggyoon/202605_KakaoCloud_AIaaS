import { fetchSceneTimeline } from '@/app/lib/aiDb';
import { isValidApiKey } from '@/app/lib/apiKeys';

// 외부 점수 API — vm5 scene_scores 원본 타임라인 반환.
// 서버→서버 소비자, X-API-Key 인증. CORS 헤더 없음.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ tmdb_id: string }> }
) {
  // 1. 인증: X-API-Key를 vm4 api_keys(해시)와 대조. 유효한 활성 키만 통과.
  const provided = request.headers.get('x-api-key');
  if (!(await isValidApiKey(provided))) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 2. 검증: tmdb_id는 양의 정수.
  const { tmdb_id } = await params;
  const id = Number(tmdb_id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: 'invalid tmdb_id' }, { status: 400 });
  }

  // 3. 조회 → 상태코드 매핑.
  const result = await fetchSceneTimeline(id);
  if (result.kind === 'not_found') {
    return Response.json({ error: 'movie not found' }, { status: 404 });
  }
  if (result.kind === 'upstream_error') {
    return Response.json({ error: 'upstream error' }, { status: 502 });
  }
  return Response.json(result.data, { status: 200 });
}
