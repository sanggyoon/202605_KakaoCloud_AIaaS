# FE valence 색상 이중인코딩 + 가중 유사도 설계

**작성일:** 2026-06-15
**범위:** 4K_FE 전용. BE/DB 변경 없음 — G가 생성한 `roberta-va-v1::arousal`(z-score)·`::valence`(raw 0~1) 벡터를 사용.
**선행:** G(임베딩) 완료(두 축 벡터 적재). 관련 [[project_4k_ml_pipeline]].

---

## 1. 목표

클라이맥스 곡선에 **두 감정 축을 동시 표현**한다: arousal=곡선 **높이**, valence=곡선 **색**. 그리고 유사 추천을 **두 축 결합**으로 재랭킹한다.

---

## 2. 핵심 결정 (브레인스토밍 확정)

| # | 결정 |
|---|---|
| 1 | 팔레트 **A**: Teal `#2dd4bf` → Purple `#7b61ff` → Pink `#ff6ec7` (부정→중립→긍정) |
| 2 | 색 매핑 = **영화별 정규화**: 그 영화 valence의 min→max를 팔레트 전 구간에 펼침(씬별 분위기 또렷). 영화 간 절대 비교는 포기하고 영화 내 감정 여정 가독성을 택함 |
| 3 | arousal=곡선 높이, valence=곡선 색. 같은 200점 그리드라 인덱스 i로 짝(높이=arousal[i], 색=valence[i]) |
| 4 | 적용면: 상세 `ClimaxGraph`, 유사카드 `MiniGraph` 둘 다 색상. 상세에 색 범례 + 호버 분위기 |
| 5 | 가중 유사도 = **0.5·cos(arousal) + 0.5·cos(valence)** (동등 결합) |

---

## 3. 데이터 (`app/lib/data.ts`)

valence 벡터도 fetch해야 함. 신규 2개(기존 arousal 전용 함수는 유지하되 내부 재사용 가능):

```
fetchVectorPair(tmdbId): Promise<{ arousal: number[]; valence: number[] } | null>
  // movie_vectors?tmdb_id=eq.X&vector_version=in.("roberta-va-v1::arousal","roberta-va-v1::valence")&select=vector_version,vector
  // 두 행을 축별로 분리. arousal 없으면 null. valence 없으면 valence: [] (색 폴백).

fetchMovieVectorPairs(tmdbIds): Promise<Map<number, { arousal: number[]; valence: number[] }>>
  // tmdb_id=in.(...) & vector_version=in.(arousal,valence), select=tmdb_id,vector_version,vector → tmdb별 그룹핑.
```
- `vector_version=in.(...)` 의 `::`/괄호/쉼표는 PostgREST 규칙대로 인코딩(구현 시 한 건 호출로 200 확인). 값은 `"roberta-va-v1::arousal"`처럼 따옴표로 감쌈.

---

## 4. 색상 (`app/lib/color.ts`, 신규 순수 모듈)

```
PALETTE_A = [[45,212,191], [123,97,255], [255,110,199]]   // teal, purple, pink (RGB)

valenceToUnit(valence: number[]): number[]
  // 영화별 정규화: (v - min) / (max - min || 1) → 0~1 배열. 빈 배열 → [].

valenceColorAt(t: number): string   // t 0~1 → 3-stop diverging lerp → "#rrggbb"

valenceGradientStops(valence: number[], n = 48): { offset: number; color: string }[]
  // u = valenceToUnit(valence); n개 지점에서 offset(0~1)과 색. valence 빈 배열이면 [].
```
- 단색 폴백: valence 없거나 빈 배열이면 그래프는 기존 `var(--accent)` 단색.

---

## 5. 컴포넌트

### 5.1 `ClimaxGraph.tsx`
- prop 추가 `valence?: number[]`.
- valence 있으면 stroke를 `<linearGradient>`(x축, `valenceGradientStops`)로 칠함. 없으면 현행 단색.
- 호버 툴팁에 **분위기 행** 추가: 색 스와치(해당 지점 `valenceColorAt(u[idx])`) + 라벨(`u[idx]<0.33`→"어두움", `<0.66`→"중립", else "밝음"). 교차점 dot도 그 색으로.
- 기존 진행도/피크 행 유지.

### 5.2 `MiniGraph.tsx`
- prop 추가 `valence?: number[]`. 있으면 동일 그라데이션 stroke, 없으면 단색. (기존 `reference` prop은 미사용이므로 제거.)

### 5.3 `DetailOverlay.tsx`
- 상태를 `{ arousal, valence }` 쌍으로: `fetchVectorPair`로 메인, `fetchMovieVectorPairs`로 후보.
- `ClimaxGraph data={arousal} valence={valence}` 전달.
- 그래프 아래 **색 범례**: teal→purple→pink 바 + "어두운 분위기 ↔ 밝은 분위기".
- 유사 재랭킹: `sim = 0.5*cos(arousal,arousal') + 0.5*cosCentered(valence,valence')` 내림차순 상위 4. MATCH% = round(sim*100). 각 카드 `MiniGraph data={arousal'} valence={valence'}`.

---

## 6. 유사도 (`app/lib/climax.ts`)

- 기존 `cosineSimilarity` 유지(arousal용, z-score라 그대로).
- 추가 `meanCenter(v): number[]` — valence(raw, 전부 양수)는 중심화해야 코사인 변별이 생김. valence 항은 `cosineSimilarity(meanCenter(a), meanCenter(b))`.
- 결합 가중치 0.5/0.5는 `DetailOverlay`에서 계산(상수). 한 축 벡터 없으면 그 축 기여 0, 있는 축만.

---

## 7. 엣지/리스크

- **valence 결측 영화**(arousal만 적재된 G 스킵 케이스): 색 폴백(단색), 유사도 valence항 0.
- **영화별 정규화의 의미**: 색은 "이 영화 기준" 상대값 — 범례 문구로 명확화. 영화 간 절대 톤 비교는 의도적으로 포기(사용자 결정).
- **PostgREST `in.()` + `::`**: 구현 시 인코딩 확인(한 건 호출 200 + 두 축 반환).
- **벡터 정렬 전제**: arousal·valence 둘 다 G의 동일 [0,1] 200점 그리드 → 인덱스 짝 안전.

---

## 8. 테스트

- FE 테스트 러너 없음 → `npm run build`(타입체크) + 배포 후 수동.
- 순수 모듈 `color.ts`(`valenceToUnit`/`valenceColorAt`/`valenceGradientStops`)·`climax.ts meanCenter`는 `npx tsx` 일회성 스폿체크(알려진 입력→기대 색/중심화).
- 수동: 상세 곡선 색·범례·호버 분위기, 미니그래프 색, 유사 MATCH%가 0.5/0.5로 바뀜.

## 9. 범위 밖

- 토글(arousal/valence 전환) 보조 기능. BE/DB·G 변경. 색 절대 스케일(영화 간 비교) 옵션.
