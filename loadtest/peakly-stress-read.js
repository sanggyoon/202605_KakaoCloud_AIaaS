// Peakly 읽기 핫패스 붕괴점 — /api/visit 제거(쓰기 없음) + 완만 램프로 HPA가 자리잡은 뒤
// FE 페이지 + Supabase movie 조회의 진짜 한계를 찾는다. 쓰기가 없어 visits 정리 불필요.
// 실행: SUPABASE_ANON_KEY=<공개 anon 키> k6 run loadtest/peakly-stress-read.js
//
// 주의: movie 응답이 iteration당 ~170KB라 고VU에서 부하 VM 1대의 NIC/CPU가 먼저 천장일 수
//       있다. k6 p95가 나쁜데 Grafana에서 vm4/vm1 CPU가 안 max면 = 생성기가 병목(서비스 아님).
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const FE = 'https://peakly.art';
const DB = 'https://data.peakly.art';
const ANON = __ENV.SUPABASE_ANON_KEY;

export const options = {
  // 완만 램프 — 각 단계 2분 유지로 HPA가 따라잡을 시간을 준다.
  stages: [
    { duration: '2m', target: 200 },   // 워밍업(HPA 스케일업 여유)
    { duration: '2m', target: 500 },   // run1 안전 지점 재확인
    { duration: '2m', target: 800 },
    { duration: '2m', target: 1200 },
    { duration: '2m', target: 1600 },
    { duration: '2m', target: 2000 },  // 강하게
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '30s' }],
    http_req_duration: [{ threshold: 'p(95)<3000', abortOnFail: true, delayAbortEval: '30s' }],
  },
};

const fePage = new Trend('fe_page_ms', true);
const dbQuery = new Trend('db_movies_ms', true);

export default function () {
  // 1) FE 페이지 (FE 파드가 /dashboard HTML 서빙)
  const fe = http.get(`${FE}/dashboard`, { tags: { path: 'fe_page' } });
  fePage.add(fe.timings.duration);
  check(fe, { 'fe 2xx/3xx': (r) => r.status >= 200 && r.status < 400 });

  // 2) Supabase 영화 목록 (브라우저가 vm4로 직접 조회) — 실제 사용자 핫패스
  const db = http.get(
    `${DB}/rest/v1/movies?select=*&limit=120&order=has_vector.desc,release_year.desc,id.desc`,
    { headers: { apikey: ANON }, tags: { path: 'db_movies' } },
  );
  dbQuery.add(db.timings.duration);
  check(db, { 'db 200': (r) => r.status === 200 });

  sleep(1); // 사용자 think-time
}
