export interface Movie {
  id: string;
  title: string;
  titleKo: string;
  year: number;
  director: string;
  cast: string[];
  genre: string[];
  runtime: number;
  dScore: number;
  pattern: string;
  poster: string;
  posterAccent: string;
  synopsis: string;
  graph: number[];
  similar: string[];
}

export const MOVIES: Movie[] = [
  {
    id: "interstellar",
    title: "Interstellar",
    titleKo: "인터스텔라",
    year: 2014,
    director: "Christopher Nolan",
    cast: ["Matthew McConaughey", "Anne Hathaway", "Jessica Chastain"],
    genre: ["SF", "Drama"],
    runtime: 169,
    dScore: 92,
    pattern: "slow-burn",
    poster: "linear-gradient(155deg, #1a2840 0%, #0a1020 50%, #2a1810 100%)",
    posterAccent: "#d4a574",
    synopsis: "지구의 미래를 위해 웜홀을 통한 우주 탐사를 떠나는 전직 NASA 파일럿의 이야기. 시간과 중력, 사랑이 교차하는 서사시.",
    graph: [12, 18, 22, 30, 35, 28, 40, 55, 48, 62, 75, 88, 92, 78, 95, 70, 50, 35],
    similar: ["arrival", "gravity", "dune"],
  },
  {
    id: "parasite",
    title: "Parasite",
    titleKo: "기생충",
    year: 2019,
    director: "Bong Joon-ho",
    cast: ["Song Kang-ho", "Lee Sun-kyun", "Cho Yeo-jeong"],
    genre: ["Thriller", "Drama"],
    runtime: 132,
    dScore: 96,
    pattern: "double-peak",
    poster: "linear-gradient(165deg, #2c2418 0%, #0d0a05 50%, #3a1a10 100%)",
    posterAccent: "#c89055",
    synopsis: "전원 백수인 기택네 가족이 박사장네에 한 명씩 들어가며 벌어지는 예측 불가의 이야기.",
    graph: [10, 15, 25, 38, 50, 62, 70, 65, 55, 60, 75, 88, 95, 99, 80, 60, 42, 28],
    similar: ["burning", "oldboy", "gone-girl"],
  },
  {
    id: "everything",
    title: "Everything Everywhere All at Once",
    titleKo: "에브리씽 에브리웨어 올 앳 원스",
    year: 2022,
    director: "Daniels",
    cast: ["Michelle Yeoh", "Ke Huy Quan", "Jamie Lee Curtis"],
    genre: ["SF", "Comedy", "Drama"],
    runtime: 139,
    dScore: 89,
    pattern: "chaos-build",
    poster: "linear-gradient(135deg, #4a1a4a 0%, #1a0820 50%, #2a4a4a 100%)",
    posterAccent: "#e8a8d8",
    synopsis: "다중우주를 넘나들며 자신의 평행세계와 마주한 평범한 세탁소 주인의 가족 이야기.",
    graph: [20, 35, 50, 45, 60, 75, 70, 85, 92, 80, 90, 95, 88, 75, 65, 80, 60, 45],
    similar: ["matrix", "swiss-army", "scott-pilgrim"],
  },
  {
    id: "whiplash",
    title: "Whiplash",
    titleKo: "위플래쉬",
    year: 2014,
    director: "Damien Chazelle",
    cast: ["Miles Teller", "J.K. Simmons"],
    genre: ["Drama", "Music"],
    runtime: 107,
    dScore: 94,
    pattern: "crescendo",
    poster: "linear-gradient(170deg, #3a1a0a 0%, #0a0505 60%, #5a2a0a 100%)",
    posterAccent: "#e8b070",
    synopsis: "최고의 드러머가 되기 위해 광기 어린 교수와 부딪히는 음대생의 처절한 성장기.",
    graph: [15, 22, 30, 28, 40, 48, 55, 50, 62, 70, 75, 68, 80, 85, 92, 96, 99, 70],
    similar: ["black-swan", "social-network", "la-la-land"],
  },
  {
    id: "arrival",
    title: "Arrival",
    titleKo: "컨택트",
    year: 2016,
    director: "Denis Villeneuve",
    cast: ["Amy Adams", "Jeremy Renner"],
    genre: ["SF", "Drama"],
    runtime: 116,
    dScore: 85,
    pattern: "slow-burn",
    poster: "linear-gradient(150deg, #1a2a35 0%, #050a10 60%, #1a1a2a 100%)",
    posterAccent: "#7a9eb8",
    synopsis: "외계인과의 첫 접촉. 언어학자가 풀어내는 시간과 기억의 미스터리.",
    graph: [8, 14, 20, 28, 35, 42, 38, 50, 58, 65, 72, 80, 85, 78, 88, 65, 48, 30],
    similar: ["interstellar", "blade-runner", "ex-machina"],
  },
  {
    id: "mad-max",
    title: "Mad Max: Fury Road",
    titleKo: "매드맥스: 분노의 도로",
    year: 2015,
    director: "George Miller",
    cast: ["Tom Hardy", "Charlize Theron"],
    genre: ["Action", "SF"],
    runtime: 120,
    dScore: 91,
    pattern: "constant-high",
    poster: "linear-gradient(160deg, #4a2010 0%, #1a0805 50%, #6a3010 100%)",
    posterAccent: "#e87040",
    synopsis: "황무지를 가로지르는 광기의 추격전. 두 시간 내내 폭주하는 액션의 정수.",
    graph: [40, 55, 70, 75, 82, 78, 85, 90, 88, 92, 85, 90, 95, 98, 88, 85, 70, 55],
    similar: ["dune", "blade-runner", "matrix"],
  },
  {
    id: "burning",
    title: "Burning",
    titleKo: "버닝",
    year: 2018,
    director: "Lee Chang-dong",
    cast: ["Yoo Ah-in", "Steven Yeun", "Jeon Jong-seo"],
    genre: ["Mystery", "Drama"],
    runtime: 148,
    dScore: 88,
    pattern: "slow-burn",
    poster: "linear-gradient(175deg, #2a1a08 0%, #0a0805 60%, #1a0a05 100%)",
    posterAccent: "#a87040",
    synopsis: "두 청춘과 한 여자, 그리고 사라진 진실. 모호함이 만드는 긴장의 미장센.",
    graph: [10, 12, 18, 22, 25, 30, 35, 32, 40, 48, 55, 62, 70, 78, 85, 92, 95, 80],
    similar: ["parasite", "oldboy", "memories"],
  },
  {
    id: "dune",
    title: "Dune",
    titleKo: "듄",
    year: 2021,
    director: "Denis Villeneuve",
    cast: ["Timothée Chalamet", "Zendaya", "Rebecca Ferguson"],
    genre: ["SF", "Adventure"],
    runtime: 155,
    dScore: 87,
    pattern: "rising-wave",
    poster: "linear-gradient(155deg, #6a4520 0%, #1a0c05 60%, #4a2510 100%)",
    posterAccent: "#d4a060",
    synopsis: "우주의 향료를 둘러싼 가문 간 전쟁. 사막 행성 아라키스를 무대로 한 대서사.",
    graph: [12, 20, 28, 35, 42, 38, 50, 58, 52, 65, 72, 68, 80, 85, 90, 78, 85, 65],
    similar: ["interstellar", "arrival", "mad-max"],
  },
];

export const PATTERNS: Record<string, { name: string; desc: string }> = {
  "slow-burn": { name: "Slow Burn", desc: "조용히 끓어오르다 후반에 폭발" },
  "double-peak": { name: "Double Peak", desc: "두 번의 클라이맥스" },
  "chaos-build": { name: "Chaos Build", desc: "혼돈 속 점진적 상승" },
  "crescendo": { name: "Crescendo", desc: "끝없이 치솟는 마무리" },
  "constant-high": { name: "Constant High", desc: "내내 최고조" },
  "rising-wave": { name: "Rising Wave", desc: "파도처럼 점차 고조" },
};

export const SITUATIONS = ["혼자", "데이트", "가족", "친구", "주말 밤", "비 오는 날", "출근길", "여행"];
export const GENRES = ["SF", "Drama", "Thriller", "Action", "Comedy", "Mystery", "Music", "Adventure"];

export const INITIAL_FILTERS = {
  yearRange: [2014, 2022] as [number, number],
  genre: "All",
  situation: "All",
  likes: ["interstellar", "whiplash"],
  dislikes: ["mad-max"],
};
