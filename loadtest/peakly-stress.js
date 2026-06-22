// Peakly 붕괴점(breaking point) 탐색 — peakly-rampup.js와 동일 워크로드, VU만 상향.
// 500 VU는 이미 안전(DB ~97%)이라 그 위를 계단식으로 올려 자동중단(=붕괴) 지점을 찾는다.
// 실행: SUPABASE_ANON_KEY=<공개 anon 키> k6 run loadtest/peakly-stress.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const FE = 'https://peakly.art';
const DB = 'https://data.peakly.art';
const ANON = __ENV.SUPABASE_ANON_KEY;

export const options = {
  // 500 위를 100 VU 계단으로 올려 어느 단계에서 무너지는지 특정한다.
  stages: [
    { duration: '1m', target: 400 },   // 워밍업(이미 안전한 구간 빠르게 통과)
    { duration: '2m', target: 500 },   // 기준점 재확인
    { duration: '2m', target: 600 },
    { duration: '2m', target: 700 },
    { duration: '2m', target: 800 },
    { duration: '2m', target: 1000 },  // 마지막 강하게
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    // 이 임계가 곧 "붕괴" 판정. 30초 지속 시 자동 abort → 그 순간 VU가 붕괴점.
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '30s' }],
    http_req_duration: [{ threshold: 'p(95)<3000', abortOnFail: true, delayAbortEval: '30s' }],
  },
};

const fePage = new Trend('fe_page_ms', true);
const dbQuery = new Trend('db_movies_ms', true);
const beVisit = new Trend('be_visit_ms', true);

export default function () {
  // 1) FE 페이지 (FE 파드 서빙)
  const fe = http.get(`${FE}/dashboard`, { tags: { path: 'fe_page' } });
  fePage.add(fe.timings.duration);
  check(fe, { 'fe 2xx/3xx': (r) => r.status >= 200 && r.status < 400 });

  // 2) Supabase 영화 목록 (vm4) — 브라우저 client-side fetch 흉내
  const db = http.get(
    `${DB}/rest/v1/movies?select=*&limit=120&order=has_vector.desc,release_year.desc,id.desc`,
    { headers: { apikey: ANON }, tags: { path: 'db_movies' } },
  );
  dbQuery.add(db.timings.duration);
  check(db, { 'db 200': (r) => r.status === 200 });

  // 3) 방문 비콘 (→ BE FastAPI). visit 행이 써지므로 테스트 후 정리.
  const be = http.post(`${FE}/api/visit`, JSON.stringify({ visitor_id: uuidv4() }),
    { headers: { 'Content-Type': 'application/json' }, tags: { path: 'be_visit' } });
  beVisit.add(be.timings.duration);

  sleep(1); // 사용자 think-time
}
