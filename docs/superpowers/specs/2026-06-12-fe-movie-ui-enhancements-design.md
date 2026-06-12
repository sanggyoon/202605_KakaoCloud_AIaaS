# 프론트엔드 영화 UI 개선 설계 (온보딩·정렬·상세지표·유사추천)

**작성일:** 2026-06-12
**범위:** 4K_FE 전용 (BE/DB 변경 없음). 기존 데이터(`movies`, `movie_vectors`)만 사용.

---

## 1. 목표

서비스 정체성과 클라이맥스 데이터를 더 잘 드러내도록 FE를 개선한다:
1. 온보딩 3카드 제거 + 감각적 태그라인.
2. 대시보드 목록을 **그래프 데이터 보유 → 최신순**으로 정렬.
3. 상세 오버레이에 **클라이맥스 지표 카드 + 피크 마커/범례** 추가.
4. 유사 추천에 **MATCH % + 약식 미니그래프(점선 비교)** 추가.

모든 지표·유사도는 이미 fetch되는 `movie_vectors` 벡터(클라이맥스 곡선, 0~100 스케일)에서 **클라이언트 계산**.

---

## 2. 핵심 결정 (브레인스토밍 확정)

| # | 결정 |
|---|---|
| 1 | 태그라인 **"한 편의 감정을 데이터로 그리다"**, FEATURES 3카드 제거 |
| 2 | 정렬 `has_vector desc, release_year desc, id desc` (그래프 보유 먼저, 신작순) |
| 3 | 강도=`max/10`, 절정위치=`argmax/len×100%`, 긴장피크=`국소최대(>평균+0.5σ) 개수`; 상위 3봉우리 ①②③ 마커, %=`봉우리/최고점×100`, 라벨=위치(전반부<33%/중반/후반>66%)+서술어 |
| 4 | match%=**코사인 유사도×100**, 표시 내림차순 정렬, MiniGraph에 점선 reference(현재 영화) 오버레이. DTW 재랭크→코사인 재랭크로 교체 |

---

## 3. 파일 구조

| 파일 | 변경 |
|---|---|
| `app/lib/climax.ts` | **신규** — 순수 함수: cosineSimilarity, findPeaks, climaxMetrics, topPeaks |
| `app/page.tsx` | FEATURES 3카드 제거 + 태그라인 |
| `app/dashboard/page.tsx` | fetchMovies order 절 변경 |
| `app/components/DetailOverlay.tsx` | 지표 카드·피크 범례 추가, 유사 재랭크 코사인 전환, match%·MiniGraph 추가 |
| `app/components/ClimaxGraph.tsx` | 선택적 `markers` prop(①②③ 점) |
| `app/components/MiniGraph.tsx` | 선택적 `reference` prop(점선 오버레이) |

> FE는 테스트 러너가 없음 → 검증은 `npm run build`/`npm run lint` + 배포 후 수동 확인. `climax.ts`는 순수 함수라 결정적.

---

## 4. 컴포넌트 설계

### 4.1 `app/lib/climax.ts` (신규, 순수)

```
cosineSimilarity(a: number[], b: number[]): number   // 0~1, 길이 다르면 min 길이까지 / 0벡터 0
findPeaks(v: number[], minProminenceσ=0.5): number[]  // 국소최대 & 값>mean+minProminenceσ·std 인덱스
climaxMetrics(v): { intensity: number; peakPositionPct: number; peakCount: number }
  // intensity = max(v)/10 (소수1자리), peakPositionPct = round(argmax/(len-1)*100), peakCount = findPeaks(v).length
topPeaks(v, n=3): { index: number; valuePct: number; positionLabel: string }[]
  // 높이 상위 n개(좌→우 순번), valuePct = round(value/max*100), positionLabel = 위치+서술어
```
- 위치 라벨: index/len < 0.33 → "전반부", < 0.66 → "중반", else "후반". 서술어: 최고봉(=100%) → "최고조", 그 외 → "절정"/"피크"(상위순).
- 빈/단일 벡터 방어: peakCount 0, intensity 0 등 안전 기본값.

### 4.2 온보딩 (`app/page.tsx`)

- `FEATURES` 배열과 그 렌더(3카드 그리드) 제거.
- 그 자리에 태그라인 한 줄: **"한 편의 감정을 데이터로 그리다"** (기존 타이틀/서브카피 스타일 따름, Playfair serif 등 기존 톤 유지). 진입 버튼/배경(BackgroundThread)은 유지.

### 4.3 대시보드 정렬 (`app/dashboard/page.tsx`)

- `fetchMovies`의 URL `order=release_year.desc,id.desc` → **`order=has_vector.desc,release_year.desc,id.desc`**.
- 전제: `has_vector`가 `movies`의 실제 정렬 가능 컬럼(현재 `select=*`로 반환됨). 구현 시 PostgREST 정렬 동작 확인. NULL은 PostgREST 기본(nullslast)로 뒤로 가 자연스러움.
- 선호필터(fetchPreferredMovies) 경로는 유사도 정렬이라 변경 없음(현행 유지).

### 4.4 상세 지표 + 피크 (`DetailOverlay.tsx` + `ClimaxGraph.tsx`)

- CLIMAX GRAPH 섹션 위에 **지표 카드 3개**(grid): 클라이맥스 강도 `{intensity}/10`, 절정 위치 `{peakPositionPct}% 지점`, 긴장 피크 `{peakCount}회`. (`climaxMetrics(vector)`), vector 로딩 중엔 자리만.
- `ClimaxGraph`에 `markers?: {index, label}[]` prop 추가 → 곡선 위 해당 인덱스 좌표에 ①②③ 원형 마커. DetailOverlay가 `topPeaks(vector,3)`로 계산해 전달.
- 그래프 아래 **범례**: ①②③ + `{positionLabel} · 강도 {valuePct}%` (이미지2 형식).
- 벡터 없으면 지표/마커/범례 미표시(기존 "준비중" 유지).

### 4.5 유사 추천 match% + 미니그래프 (`DetailOverlay.tsx` + `MiniGraph.tsx`)

- 유사 재랭크: 현재 DTW(`dtwDistance`) → **코사인**으로 교체. `fetchMovieVectors`로 받은 후보 벡터와 `cosineSimilarity(queryVec, candVec)` 계산 → **내림차순 상위 4**. `dtwDistance` 함수 제거.
- 각 추천을 `{movie, vector, matchPct}`로 보관(벡터는 미니그래프용으로 유지).
- 카드 레이아웃 보강(이미지3): 좌측 **MATCH %**(`matchPct`, 큰 숫자 + "MATCH %"), 가운데 포스터·제목·연도·장르, 우측 **MiniGraph**(해당 영화 실선 + 현재 영화 점선 reference).
- `MiniGraph`에 `reference?: number[]` prop 추가 → 동일 좌표계에 점선(`stroke-dasharray`, 흐린 회색) 곡선을 solid 뒤에 렌더.

---

## 5. 데이터 흐름

- 모든 신규 표시는 `movie_vectors` 벡터에서 파생(이미 `DetailOverlay`가 `fetchVector` + `fetchMovieVectors`로 가져옴). **신규 API/DB 없음.**
- 대시보드 정렬은 기존 `movies` REST에 order 절만 변경.
- 벡터 스케일은 기존 그래프 컴포넌트와 동일(0~100) 가정. (현재 movie_vectors는 rule-v1; G 재구현 후 roberta-va-v1로 바뀌어도 0~100 유지 시 그대로 동작.)

## 6. 엣지/리스크

- **has_vector 정렬**: 실제 컬럼이 아니면 order 실패 → 구현 시 확인. 대안: movie_vectors 보유 여부 조인(범위 커지므로 컬럼 전제).
- **짧은/빈 벡터**: climax.ts가 안전 기본값 반환, UI는 미표시/0 처리.
- **벡터 스케일 가정(0~100)**: 다르면 intensity(/10)가 어긋남 → 구현 시 실제 값 1건 확인해 보정.
- **유사 후보가 벡터 없음**: cosineSimilarity 0 → 후순위, 4개 못 채우면 있는 만큼.

## 7. 테스트

- FE 테스트 러너 없음 → `npm run lint` + `npm run build`(타입체크) + 배포 후 수동 확인(온보딩 문구, 대시보드 정렬, 상세 지표/마커, 유사 match%/미니그래프).
- `climax.ts`는 순수 함수라 구현 중 노드 콘솔로 스폿 검증(알려진 입력 → 기대 출력).

## 8. 범위 밖

- BE/DB·추천 RPC 변경 없음. movie_vectors 생성(G)·스코어링(F)은 별개.
- 새 페이지/라우트 없음.
