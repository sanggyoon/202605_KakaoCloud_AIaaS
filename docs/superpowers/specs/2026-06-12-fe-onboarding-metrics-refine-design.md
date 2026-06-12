# 온보딩 태그라인 · 지표 수식 · 그래프 스케일 개선 설계

**작성일:** 2026-06-12
**범위:** 4K_FE 전용 (BE/DB 변경 없음). 기존 `movie_vectors` 벡터만 사용.
**선행:** `2026-06-12-fe-movie-ui-enhancements-design.md` (이번엔 그 후속 다듬기)

> **주의:** `movie_vectors`는 향후 G(roberta-va-v1)로 재생성될 수 있다. 모든 수식은 입력 배열을 **내부에서 z-score 정규화**해 계산하므로 입력 스케일(0~100이든 z이든)에 견고하다. 모델 점수 서비스화 단계에서 일부 매핑 상수는 재조정될 수 있다.

---

## 1. 배경 / 문제

직전 작업(movie-ui-enhancements)은 벡터가 `0~100` 스케일이라 가정했으나, 실제 `movie_vectors`는 **z-score 정규화**(평균 0, 표준편차 1, 대략 -3~+2.5)였다. 40편 샘플로 확인. 이 가정 불일치가 두 증상의 공통 원인:

- **미니그래프 평평함**: `MiniGraph`가 `v/100`으로 Y매핑 → z값(-3~2.5)이 전부 바닥(±0.03)에 붙어 거의 직선. (큰 `ClimaxGraph`는 자체 min/max 정규화라 굴곡이 정상으로 보였음.)
- **지표 무의미**: `강도 = max(v)/10` → max가 항상 z≈2.0~2.5 → 모든 영화가 `0.2/10` 고정. 절정 위치만 정상. 긴장 피크는 임계값이 평균+0.5σ로 낮아 잔물결까지 ~13개 셈.

추가로 온보딩 태그라인이 정적이라는 피드백.

---

## 2. 핵심 결정 (브레인스토밍 확정)

| # | 결정 |
|---|---|
| 1 | 태그라인: 로고 유지, 텍스트만 `Nanum Myeongjo`(세리프) + 단어별 순차 페이드업 + 핵심어("감정"·"데이터") accent 글로우. 진입 시 **1회** 재생 |
| 2 | 강도 = **정점 높이**: `clamp((maxZ − 1.0)/2.5 × 10, 0, 10)`, `maxZ=(max−mean)/std`. 절정 위치=현행 유지. 긴장 피크 = `z>1.0` & ±W윈도 국소최댓값인 분리된 봉우리 수 |
| 3 | 그래프 스케일: `toDisplayScale(v)` = 내부 z정규화 후 `(z+3)/6×100` clamp(0~100). `MiniGraph` 실선·점선 모두 적용. `ClimaxGraph`는 현행(영화별 min/max) 유지 |

---

## 3. 측정 근거 (40편 샘플 분포: min / median / max)

| 후보 지표 | 분포 | 채택 |
|---|---|---|
| maxZ | 1.30 / 2.19 / 3.45 | **강도** (잘 갈림) |
| argmax 위치% | 0 / ~40 / 95 | **절정 위치** (그대로) |
| 봉우리(z>0.8) | 5 / 9 / 13 | 너무 많음 |
| 봉우리(z>1.2) | 2 / 5 / 9 | 참고 |
| 봉우리(z>1.6) | 0 / 3 / 5 | 참고 |

긴장 피크는 `z>1.0` + 분리 윈도로 잔물결 제거 → 실측상 ~3~6개 범위.

---

## 4. 파일 구조

| 파일 | 변경 |
|---|---|
| `app/lib/climax.ts` | `climaxMetrics`/`topPeaks`/`findPeaks` 수식 교체, `toDisplayScale` 신규 |
| `app/components/MiniGraph.tsx` | `v/100` → `toDisplayScale` 기반 Y매핑 (data·reference 공통) |
| `app/page.tsx` | 태그라인 마크업/스타일 교체(세리프·순차 모션·글로우) |
| `app/layout.tsx` | `Nanum_Myeongjo` next/font 추가, `--font-serif-ko` 변수 |
| `app/globals.css` | 순차 페이드업 keyframes(`taglineUp`) 추가 |
| `app/components/DetailOverlay.tsx` | 변경 없음 (범례는 `topPeaks.valuePct`를 그대로 표기, 의미만 display 스케일로 바뀜) |
| `app/components/ClimaxGraph.tsx` | 변경 없음 |

---

## 5. `climax.ts` 상세 (순수 함수)

내부 헬퍼 `zscore(v)` 추가: `mean`, `std`(0이면 1) 구해 `(x-mean)/std` 배열 반환.

```
toDisplayScale(v: number[]): number[]
  // z = zscore(v); 각 원소를 clamp(((z+3)/6)*100, 0, 100). 빈 배열 → []
```

```
climaxMetrics(v): { intensity, peakPositionPct, peakCount }
  // z = zscore(v)
  // maxZ = max(z); argmax = z의 최댓값 인덱스
  // intensity   = round(clamp((maxZ - 1.0)/2.5*10, 0, 10) * 10)/10   // 0~10, 소수1
  // peakPositionPct = round(argmax/(len-1)*100)                       // 현행과 동일
  // peakCount   = countPeaks(v).length
  // 빈/길이<3 → {0,0,0} 안전 기본값
```

```
countPeaks(v, k=1.0, win=Math.max(3, round(len*0.04))): number[]
  // z = zscore(v). i가 [i-win, i+win] 범위에서 (경계 clamp) 엄격 최댓값이고 z[i] > k 이면 봉우리.
  // 같은 평탄 구간 중복 방지: z[i] >= 이웃 비교 시 좌측은 >, 우측은 >= 로 단일화.
  // win 분리로 인접 잔봉우리 합쳐짐. 인덱스 배열 반환.
```

```
topPeaks(v, n=3): { index, valuePct, label }[]
  // cand = countPeaks(v); 비면 [argmax]
  // 높이(z값) 상위 n → 좌→우 정렬
  // valuePct = round(toDisplayScale(v)[index])   // 고정 display 스케일(0~100) 상의 높이 %
  // label = 위치(전반부<0.33 / 중반<0.66 / 후반) + 서술어(rank0 최고조 / 1 절정 / 2 피크)
```

> `findPeaks`는 `countPeaks`로 대체(임계값 0.5→1.0 + 분리 윈도). 외부에서 `findPeaks`를 직접 쓰는 곳 없음(climax.ts 내부 전용)이므로 안전.

---

## 6. `MiniGraph` 상세

- 현행: `pts = data.map((v,i) => [x, 2+innerH - (v/100)*innerH])`.
- 변경: 컴포넌트 진입부에서 `const ds = toDisplayScale(data); const rs = reference ? toDisplayScale(reference) : null;` 계산 후 `v/100` 대신 `ds[i]/100`(이미 0~100) 사용. reference 경로도 동일.
- 결과: z벡터가 0~100 display로 펼쳐져 굴곡 복원. 실선·점선 동일 스케일이라 비교 의미 있음.

---

## 7. 온보딩 태그라인 상세

- `layout.tsx`: `import { Nanum_Myeongjo } from "next/font/google"` (weight 400/700, subsets ["latin"]; 한글은 글꼴 자체 글리프), `variable:"--font-serif-ko"`. body className에 변수 추가.
- `page.tsx`: 기존 단일 `<p>한 편의 감정을 데이터로 그리다</p>`를 단어 span 4개로 분할:
  `한 편의` / `<em>감정</em>을` / `<em>데이터</em>로` / `그리다`.
  - 컨테이너 `fontFamily: 'var(--font-serif-ko), serif'`, 각 단어 span `.tagline-word`(opacity:0, translateY(10px), `animation: taglineUp .6s ease forwards`), nth-child 지연 0.1/0.35/0.6/0.85s.
  - 핵심어 `em.tagline-key`: `color: var(--accent)`, `text-shadow: 0 0 18px rgba(123,97,255,.55)`, `font-style: normal`, `font-weight:700`.
  - **1회 재생**: 무한 반복 없음(`forwards`만). 페이지 진입 시 자연 1회.
- `globals.css`: `@keyframes taglineUp { to { opacity:1; transform:translateY(0) } }`.

---

## 8. 데이터 흐름 / 리스크

- 모든 표시는 `movie_vectors` 벡터에서 파생. 신규 API/DB 없음.
- **스케일 견고성**: 모든 수식이 입력을 내부 z정규화 → G 재생성으로 스케일이 바뀌어도 동작. 단 `(z+3)/6` 및 `(maxZ-1.0)/2.5` 상수는 현재 분포 기준 — 모델 점수 서비스화 때 재조정 가능(허용된 변경).
- **짧은/빈 벡터**: `zscore`가 std=0이면 1로 대체, 길이<3이면 지표 0/peak 없음.
- **ClimaxGraph vs MiniGraph 스케일 불일치(의도)**: 큰 그래프는 영화별 min/max(주인공 가독성), 미니는 고정 스케일(상호 비교). 의도된 차이.

---

## 9. 테스트

- FE 테스트 러너 없음 → `npm run lint` + `npm run build`(타입체크) + 배포 후 수동 확인.
- `climax.ts`는 순수 함수 → 구현 중 node 콘솔로 알려진 입력 스폿 검증(예: 단일 정점 벡터 → 강도↑/peak 1개, 평탄 벡터 → 강도 0).
- 수동: 온보딩 태그라인 모션·글꼴, 미니그래프 굴곡, 상세 지표 3종 값 분포.

---

## 10. 범위 밖

- BE/DB·추천 RPC 변경 없음. G(임베딩 재생성)·스코어링은 별개.
- `ClimaxGraph` 고정 스케일 통일은 보류(필요 시 후속).
