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

// Supabase Data 접속 정보 (anon key는 공개 가능)
export const SUPABASE_URL = 'https://data.4kakao.kro.kr';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzc4NTYyOTc3LCJleHAiOjIwOTM5MjI5Nzd9.QqZEZi5iPoq576IOc_Q1lLyk871_KbsIihBGyeFqm6M';

export const GENRES = [
  '액션', '모험', '애니메이션', '코미디', '범죄',
  '드라마', '판타지', '공포', '미스터리', '로맨스',
  'SF', '스릴러', '전쟁', '가족', '서부',
  '역사', '음악', '다큐멘터리', 'TV 영화',
];

export const SITUATIONS = ['혼자', '데이트', '가족', '친구', '주말 밤', '비 오는 날', '출근길', '여행'];

export interface Filters {
  yearRange: [number, number];
  genre: string;
  situation: string;
  likes: number[];     // tmdb_id 목록
  dislikes: number[];  // tmdb_id 목록
}

export const INITIAL_FILTERS: Filters = {
  yearRange: [1900, new Date().getFullYear()],
  genre: 'All',
  situation: 'All',
  likes: [],
  dislikes: [],
};

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
