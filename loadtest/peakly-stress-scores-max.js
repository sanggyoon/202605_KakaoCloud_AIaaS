// Peakly 외부 스코어 API 붕괴점 (캐싱 적용 후) — 500→3000 VU.
// scene_scores 캐싱(1h) 후 vm5 데이터 부하가 빠져 ~750 VU보다 훨씬 높이 버틸 것으로 예상.
// 남는 요청당 비용 = vm4 인증(매 요청) + FE 응답 → 새 천장은 vm4(인증) 또는 app/FE 노드.
// vm5(10.1.7)는 낮게 유지돼야 정상(= 캐시 작동 증거). 소수 id 풀 반복 = 캐시 적중 베스트케이스.
// 실행: PEAKLY_API_KEY='<발급키>' TMDB_IDS='550,278,238' k6 run loadtest/peakly-stress-scores-max.js
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = 'https://peakly.art';
const API_KEY = __ENV.PEAKLY_API_KEY; // 매니저 페이지에서 발급한 고객 API 키
// 스코어가 실제 있는 영화(has_vector=true)의 tmdb_id를 넣어야 404로 안 샌다.
const IDS = (__ENV.TMDB_IDS || '550,278,238').split(',');

export const options = {
  stages: [
    { duration: '1m', target: 500 }, // 워밍업(캐싱 후 안전 구간)
    { duration: '2m', target: 1000 },
    { duration: '2m', target: 1500 },
    { duration: '2m', target: 2000 },
    { duration: '2m', target: 2500 },
    { duration: '2m', target: 3000 },
    { duration: '2m', target: 3500 },
    { duration: '2m', target: 4000 },
    { duration: '2m', target: 4500 },
    { duration: '2m', target: 5000 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_failed: [
      { threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '30s' },
    ],
    http_req_duration: [
      { threshold: 'p(95)<3000', abortOnFail: true, delayAbortEval: '30s' },
    ],
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
