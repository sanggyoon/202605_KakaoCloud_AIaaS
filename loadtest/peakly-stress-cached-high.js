// Peakly 캐시 개선 후 붕괴점 탐색 — /api/movies(캐시) 경유로 더 높은 VU까지 밀어
// 새 천장(app 노드/FE 파드 또는 부하 생성기)을 찾는다. FE HPA maxReplicas=16 전제.
// 실행: k6 run loadtest/peakly-stress-cached-high.js
//
// 주의: 고VU에선 부하 VM 1대(NIC/CPU)가 먼저 천장일 수 있다. 부하 VM `top`을 같이 보고,
//       service 노드(Grafana)는 여유인데 p95만 나쁘면 = 생성기 한계(서비스 아님)로 판정.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const FE = 'https://peakly.art';
const LIST = 'select=id,tmdb_id,title,original_title,poster_path,release_year,genre,has_vector'
  + '&limit=120&offset=0&order=has_vector.desc,release_year.desc,id.desc';

export const options = {
  stages: [
    { duration: '2m', target: 1000 },  // 워밍업(이미 안전한 구간)
    { duration: '2m', target: 2000 },  // 4차 상한 재확인
    { duration: '2m', target: 3000 },
    { duration: '2m', target: 4000 },
    { duration: '2m', target: 5000 },  // 강하게
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
  const fe = http.get(`${FE}/dashboard`, { tags: { path: 'fe_page' } });
  fePage.add(fe.timings.duration);
  check(fe, { 'fe 2xx/3xx': (r) => r.status >= 200 && r.status < 400 });

  const api = http.get(`${FE}/api/movies?${LIST}`, { tags: { path: 'api_movies' } });
  apiMovies.add(api.timings.duration);
  check(api, { 'api 200': (r) => r.status === 200 });

  sleep(1);
}
