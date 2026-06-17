// vm5(AI DB) 직접 접근 — scene_scores 원본 타임라인 조회 전용 (서버 사이드만).
// FE의 SUPABASE_URL(vm4, data.peakly.art)와 별개. ML 파이프라인 db.py의
// _ai_headers(apikey + Bearer) 패턴 재사용. NEXT_PUBLIC_ 없음 → 브라우저 비노출.

const AI_DATABASE_URL = process.env.AI_DATABASE_URL || 'https://ai.peakly.art';
const AI_DATABASE_KEY = process.env.AI_DATABASE_KEY || '';

function aiHeaders(): Record<string, string> {
  return { apikey: AI_DATABASE_KEY, Authorization: `Bearer ${AI_DATABASE_KEY}` };
}

// vm5 PostgREST GET — 실패(비 2xx/네트워크) 시 throw.
async function aiGet<T>(table: string, params: Record<string, string>): Promise<T[]> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${AI_DATABASE_URL}/rest/v1/${table}?${qs}`, {
    headers: aiHeaders(),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`vm5 ${table} ${res.status}`);
  return (await res.json()) as T[];
}

// 활성 base 모델 버전 — vm5 model_versions.active=true 중 '::' 없는 버전.
// 모듈 레벨 1회 캐시. 실패/없음 시 폴백 'roberta-va-v1'.
let _activeBaseVersion: string | null = null;
export async function getActiveBaseVersion(): Promise<string> {
  if (_activeBaseVersion) return _activeBaseVersion;
  try {
    const rows = await aiGet<{ model_version: string }>('model_versions', {
      select: 'model_version',
      active: 'eq.true',
    });
    for (const r of rows) {
      if (r.model_version && !r.model_version.includes('::')) {
        _activeBaseVersion = r.model_version;
        return _activeBaseVersion;
      }
    }
  } catch {
    /* 폴백으로 진행 */
  }
  _activeBaseVersion = 'roberta-va-v1';
  return _activeBaseVersion;
}

export interface ScoresResponse {
  tmdb_id: number;
  model_version: string;
  length: number;
  arousal: number[];
  valence: (number | null)[];
  progress_ratio: number[];
}

export type TimelineResult =
  | { kind: 'ok'; data: ScoresResponse }
  | { kind: 'not_found' }
  | { kind: 'upstream_error' };

interface SceneRow {
  id: number;
  scene_index: number;
  progress_ratio: number;
}

interface ScoreRow {
  scenes_id: number;
  score: number;
  model_version: string;
}

// tmdb_id의 원본 scene_scores 타임라인을 scene_index 순으로 조립.
// - subtitles에 tmdb_id 없음 → not_found (404)
// - 영화는 있으나 점수 없음 → ok, 빈 배열(length 0)
// - vm5 조회 실패 → upstream_error (502)
export async function fetchSceneTimeline(tmdbId: number): Promise<TimelineResult> {
  try {
    const av = await getActiveBaseVersion();

    // 1) scenes (subtitles 임베드 필터 + scene_index 정렬)
    const scenes = await aiGet<SceneRow>('scenes', {
      select: 'id,scene_index,progress_ratio,subtitles!inner(tmdb_id)',
      'subtitles.tmdb_id': `eq.${tmdbId}`,
      order: 'scene_index.asc',
    });
    if (scenes.length === 0) return { kind: 'not_found' };

    // 2) scene_scores (해당 scene들의 av arousal/valence)
    const sceneIds = scenes.map((s) => s.id);
    const scores = await aiGet<ScoreRow>('scene_scores', {
      select: 'scenes_id,score,model_version',
      scenes_id: `in.(${sceneIds.join(',')})`,
      model_version: `in.(${av}::arousal,${av}::valence)`,
    });

    const arousalById = new Map<number, number>();
    const valenceById = new Map<number, number>();
    for (const row of scores) {
      if (row.model_version.endsWith('::arousal')) arousalById.set(row.scenes_id, row.score);
      else if (row.model_version.endsWith('::valence')) valenceById.set(row.scenes_id, row.score);
    }

    // 3) arousal 점수 있는 scene만 기준 타임라인 (scene_index 순서 유지)
    const arousal: number[] = [];
    const valence: (number | null)[] = [];
    const progress_ratio: number[] = [];
    for (const s of scenes) {
      const a = arousalById.get(s.id);
      if (a === undefined) continue;
      arousal.push(a);
      const v = valenceById.get(s.id);
      valence.push(v === undefined ? null : v);
      progress_ratio.push(s.progress_ratio);
    }

    return {
      kind: 'ok',
      data: {
        tmdb_id: tmdbId,
        model_version: av,
        length: arousal.length,
        arousal,
        valence,
        progress_ratio,
      },
    };
  } catch {
    return { kind: 'upstream_error' };
  }
}
