// Peakly 읽기 핫패스 붕괴점 — 캐시 경로(/api/movies) 측정용.
// peakly-stress-read.js는 vm4(data.peakly.art)를 직격해 캐시를 우회한다. 이 스크립트는
// 실제 브라우저처럼 FE의 /api/movies(1시간 캐시) 경유로 조회해 캐시 효과를 측정한다.
// 실행: k6 run loadtest/peakly-stress-cached.js   (anon 키 불필요 — 라우트가 서버에서 부착)
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const FE = 'https://peakly.art';
// 실제 대시보드가 보내는 축소 select + 첫 페이지 쿼리
const LIST = 'select=id,tmdb_id,title,original_title,poster_path,release_year,genre,has_vector'
  + '&limit=120&offset=0&order=has_vector.desc,release_year.desc,id.desc';

export const options = {
  stages: [
    { duration: '2m', target: 200 },
    { duration: '2m', target: 500 },
    { duration: '2m', target: 800 },
    { duration: '2m', target: 1200 },
    { duration: '2m', target: 1600 },
    { duration: '2m', target: 2000 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '30s' }],
    http_req_duration: [{ threshold: 'p(95)<3000', abortOnFail: true, delayAbortEval: '30s' }],
  },
};

const fePage = new Trend('fe_page_ms', true);
const apiMovies = new Trend('api_movies_ms', true);

export default function () {
  // 1) FE 페이지 (FE 파드가 /dashboard HTML 서빙)
  const fe = http.get(`${FE}/dashboard`, { tags: { path: 'fe_page' } });
  fePage.add(fe.timings.duration);
  check(fe, { 'fe 2xx/3xx': (r) => r.status >= 200 && r.status < 400 });

  // 2) 영화 목록 — FE의 캐시 라우트 경유(실제 브라우저 동작). 캐시 적중 시 vm4 미접촉.
  const api = http.get(`${FE}/api/movies?${LIST}`, { tags: { path: 'api_movies' } });
  apiMovies.add(api.timings.duration);
  check(api, { 'api 200': (r) => r.status === 200 });

  sleep(1); // 사용자 think-time
}
