// Peakly 외부 스코어 API 붕괴점 탐색 — 400 VU에서 안 깨져(p95 246ms) 더 높이 민다.
// 400 VU 시점에 app(vm2/vm3)·vm4 ~80%, vm5(데이터)는 ~8%로 한가 → 천장은 FE 조립/vm4 인증 쪽 예상.
// 실행: PEAKLY_API_KEY='<발급키>' TMDB_IDS='550,278,238' k6 run loadtest/peakly-stress-scores-high.js
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = 'https://peakly.art';
const API_KEY = __ENV.PEAKLY_API_KEY; // 매니저 페이지에서 발급한 고객 API 키
// 스코어가 실제 있는 영화(has_vector=true)의 tmdb_id를 넣어야 404로 안 샌다.
const IDS = (__ENV.TMDB_IDS || '550,278,238').split(',');

export const options = {
  stages: [
    { duration: '1m', target: 200 },   // 워밍업(이미 안전)
    { duration: '2m', target: 400 },   // 직전 테스트 상한 재확인
    { duration: '2m', target: 600 },
    { duration: '2m', target: 800 },
    { duration: '2m', target: 1000 },
    { duration: '2m', target: 1200 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '30s' }],
    http_req_duration: [{ threshold: 'p(95)<3000', abortOnFail: true, delayAbortEval: '30s' }],
  },
};

export default function () {
  const id = IDS[Math.floor(Math.random() * IDS.length)];
  const res = http.get(`${BASE}/api/movies/${id}/scores`, {
    headers: { 'X-API-Key': API_KEY },
    tags: { path: 'scores_api' },
  });
  check(res, { 'scores 200': (r) => r.status === 200 });
  sleep(1);
}
