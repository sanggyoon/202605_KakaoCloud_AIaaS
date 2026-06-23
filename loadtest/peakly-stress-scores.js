// Peakly 외부 스코어 API 부하 — GET /api/movies/{tmdb_id}/scores (X-API-Key 인증).
// 요청당 vm4(인증 RPC) + vm5(model_version + scenes join + scene_scores) = ~4 DB 왕복, 무캐시.
// 캐시 목록 경로와 달리 DB 직격이라 일찍 붕괴 예상 → 보수적 램프.
// 실행: PEAKLY_API_KEY='<발급키>' TMDB_IDS='550,278,238' k6 run loadtest/peakly-stress-scores.js
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = 'https://peakly.art';
const API_KEY = __ENV.PEAKLY_API_KEY; // 매니저 페이지에서 발급한 고객 API 키
// 스코어가 실제 있는 영화(has_vector=true)의 tmdb_id를 넣어야 404로 안 샌다.
const IDS = (__ENV.TMDB_IDS || '550,278,238').split(',');

export const options = {
  // DB 직격·무캐시 경로라 보수적으로 시작(과하면 stages target 낮춰 재시도).
  stages: [
    { duration: '1m', target: 25 },
    { duration: '2m', target: 50 },
    { duration: '2m', target: 100 },
    { duration: '2m', target: 200 },
    { duration: '2m', target: 400 },
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
