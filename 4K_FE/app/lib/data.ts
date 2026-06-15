// DB 스키마와 1:1 매핑되는 Movie 타입
export interface Movie {
  id: number;
  tmdb_id: number;
  imdb_id?: string | null;
  title: string;
  original_title?: string | null;
  poster_path?: string | null;
  director?: string | null;
  release_year?: number | null;
  runtime?: number | null;
  genre?: string | null;    // DB 저장 형식: "Action, Drama"
  actors?: string | null;   // DB 저장 형식: "Actor1, Actor2"
  overview?: string | null;
  youtube_key?: string | null;
  has_vector?: boolean | null;
}

// poster_path → TMDB CDN URL 변환
export function posterUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `https://image.tmdb.org/t/p/w500${path}`;
}

// 쉼표 구분 문자열 → 배열
export function genreList(genre: string | null | undefined): string[] {
  if (!genre) return [];
  return genre.split(',').map((g) => g.trim()).filter(Boolean);
}

export function castList(actors: string | null | undefined): string[] {
  if (!actors) return [];
  return actors.split(',').map((a) => a.trim()).filter(Boolean);
}

// Supabase Data 접속 정보 (anon key는 공개 가능 — JWT라 브라우저 노출 무방).
// 브라우저에서 직접 호출하므로 NEXT_PUBLIC_* 로 노출하며, 빌드 시점에 번들로 inline된다.
// Burst/DR: 이 URL(data.peakly.art)은 Route53 failover 호스트네임이므로 카카오↔AWS 전환을 DNS가 처리한다.
// env 미설정 시 기본값(data.peakly.art)을 사용한다.
// (빌드 arg 미전달로 빈 문자열이 들어올 수 있어 ?? 가 아닌 || 로 폴백)
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://data.peakly.art';
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzc4NTYyOTc3LCJleHAiOjIwOTM5MjI5Nzd9.QqZEZi5iPoq576IOc_Q1lLyk871_KbsIihBGyeFqm6M';

export const GENRES = [
  '액션', '모험', '애니메이션', '코미디', '범죄',
  '드라마', '판타지', '공포', '미스터리', '로맨스',
  'SF', '스릴러', '전쟁', '가족', '서부',
  '역사', '음악', '다큐멘터리', 'TV 영화',
];

export interface Filters {
  yearRange: [number, number];
  genre: string;
  dislikeGenres: string[];
  likes: number[];     // tmdb_id 목록
  dislikes: number[];  // tmdb_id 목록
}

export const INITIAL_FILTERS: Filters = {
  yearRange: [1900, new Date().getFullYear()],
  genre: 'All',
  dislikeGenres: [],
  likes: [],
  dislikes: [],
};

// like/dislike tmdb_id 기반으로 벡터 centroid를 계산해 유사도 순으로 영화 반환
export async function fetchPreferredMovies(
  likeIds: number[],
  dislikeIds: number[],
  matchCount = 400,
): Promise<Movie[]> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/find_preferred_movies`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ like_ids: likeIds, dislike_ids: dislikeIds, match_count: matchCount }),
    });
    if (!res.ok) return [];
    return (await res.json()) as Movie[];
  } catch {
    return [];
  }
}

// pgvector 코사인 유사도로 비슷한 패턴의 영화 4개를 반환
// vm4 Supabase RPC(find_similar_movies) 호출 — movie.id 기준
export async function fetchSimilarMovies(movieId: number, count = 4): Promise<Movie[]> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/find_similar_movies`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query_movie_id: movieId, match_count: count }),
    });
    if (!res.ok) return [];
    return await res.json() as Movie[];
  } catch {
    return [];
  }
}

// 여러 tmdb_id의 벡터를 한 번에 fetch — Map<tmdb_id, number[]> 반환
export async function fetchMovieVectors(tmdbIds: number[]): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>();
  if (tmdbIds.length === 0) return map;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/movie_vectors?tmdb_id=in.(${tmdbIds.join(',')})&vector_version=eq.roberta-va-v1::arousal&select=tmdb_id,vector`,
      { headers: { apikey: SUPABASE_ANON_KEY } },
    );
    if (!res.ok) return map;
    const rows = await res.json() as { tmdb_id: number; vector: string | number[] }[];
    for (const row of rows) {
      const v = Array.isArray(row.vector) ? row.vector : JSON.parse(row.vector as string);
      map.set(row.tmdb_id, v as number[]);
    }
  } catch { /* empty */ }
  return map;
}

// movie_vectors 테이블에서 해당 영화의 클라이맥스 벡터를 lazy fetch
// pgvector는 REST API에서 문자열 "[0.1,0.2,...]" 또는 배열로 반환
export async function fetchVector(tmdbId: number): Promise<number[] | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/movie_vectors?tmdb_id=eq.${tmdbId}&vector_version=eq.roberta-va-v1::arousal&select=vector&limit=1`,
      { headers: { apikey: SUPABASE_ANON_KEY } },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    if (!rows.length) return null;
    const raw = rows[0].vector;
    if (Array.isArray(raw)) return raw as number[];
    if (typeof raw === 'string') return JSON.parse(raw) as number[];
    return null;
  } catch {
    return null;
  }
}

// arousal+valence 두 축을 함께 fetch (상세용)
export async function fetchVectorPair(
  tmdbId: number,
): Promise<{ arousal: number[]; valence: number[] } | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/movie_vectors?tmdb_id=eq.${tmdbId}&vector_version=in.(roberta-va-v1::arousal,roberta-va-v1::valence)&select=vector_version,vector`,
      { headers: { apikey: SUPABASE_ANON_KEY } },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { vector_version: string; vector: string | number[] }[];
    let arousal: number[] | null = null;
    let valence: number[] = [];
    for (const r of rows) {
      const v = Array.isArray(r.vector) ? r.vector : (JSON.parse(r.vector as string) as number[]);
      if (r.vector_version.endsWith('::arousal')) arousal = v;
      else if (r.vector_version.endsWith('::valence')) valence = v;
    }
    return arousal ? { arousal, valence } : null;
  } catch {
    return null;
  }
}

// 여러 영화의 arousal+valence 쌍 (유사 후보용). arousal 없는 영화는 제외.
export async function fetchMovieVectorPairs(
  tmdbIds: number[],
): Promise<Map<number, { arousal: number[]; valence: number[] }>> {
  const map = new Map<number, { arousal: number[]; valence: number[] }>();
  if (tmdbIds.length === 0) return map;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/movie_vectors?tmdb_id=in.(${tmdbIds.join(',')})&vector_version=in.(roberta-va-v1::arousal,roberta-va-v1::valence)&select=tmdb_id,vector_version,vector`,
      { headers: { apikey: SUPABASE_ANON_KEY } },
    );
    if (!res.ok) return map;
    const rows = (await res.json()) as { tmdb_id: number; vector_version: string; vector: string | number[] }[];
    for (const r of rows) {
      const v = Array.isArray(r.vector) ? r.vector : (JSON.parse(r.vector as string) as number[]);
      const cur = map.get(r.tmdb_id) ?? { arousal: [], valence: [] };
      if (r.vector_version.endsWith('::arousal')) cur.arousal = v;
      else if (r.vector_version.endsWith('::valence')) cur.valence = v;
      map.set(r.tmdb_id, cur);
    }
    for (const [k, val] of map) if (val.arousal.length === 0) map.delete(k);
    return map;
  } catch {
    return map;
  }
}

// 최근 본 영화 tmdb_id 관리 (localStorage)
const RECENT_KEY = '4k_recent_ids';

export function getRecentIds(): number[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch {
    return [];
  }
}

export function addRecentId(tmdbId: number): void {
  const ids = getRecentIds().filter((id) => id !== tmdbId);
  localStorage.setItem(RECENT_KEY, JSON.stringify([tmdbId, ...ids].slice(0, 10)));
}

export function removeRecentId(tmdbId: number): void {
  localStorage.setItem(RECENT_KEY, JSON.stringify(getRecentIds().filter((id) => id !== tmdbId)));
}

// 공개 서비스 방문 비콘 — 브라우저당 하루 1회만 전송(fire-and-forget).
// localStorage에 방문자 UUID와 마지막 방문일(YYYY-MM-DD)을 저장해 중복 전송을 막는다.
export function logVisit(): void {
  if (typeof window === 'undefined') return;
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem('4k_last_visit') === today) return;

    let visitorId = localStorage.getItem('4k_visitor_id');
    if (!visitorId) {
      visitorId = crypto.randomUUID();
      localStorage.setItem('4k_visitor_id', visitorId);
    }
    localStorage.setItem('4k_last_visit', today);

    fetch('/api/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitor_id: visitorId }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* localStorage 접근 불가 등은 무시 */
  }
}
