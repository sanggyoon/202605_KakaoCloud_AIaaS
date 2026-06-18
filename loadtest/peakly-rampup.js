// Peakly 램프 부하 — FE 페이지 + Supabase 조회 + 방문 비콘(BE).
// 실행: SUPABASE_ANON_KEY=<공개 anon 키> k6 run loadtest/peakly-rampup.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const FE = 'https://peakly.art';
const DB = 'https://data.peakly.art';
const ANON = __ENV.SUPABASE_ANON_KEY;

export const options = {
  // target = 동시 가상사용자(VU) 수. 보수적으로 시작해 단계적으로 올린다.
  stages: [
    { duration: '2m', target: 50 },   // 워밍업
    { duration: '3m', target: 200 },  // 1차 램프
    { duration: '3m', target: 200 },  // 유지(HPA 반응 관찰)
    { duration: '3m', target: 500 },  // 2차 램프
    { duration: '3m', target: 500 },  // 유지
    { duration: '2m', target: 0 },    // 램프다운
  ],
  thresholds: {
    // 에러율 5% 초과 또는 p95 3초 초과가 지속되면 테스트 자동 중단(서비스 보호).
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
