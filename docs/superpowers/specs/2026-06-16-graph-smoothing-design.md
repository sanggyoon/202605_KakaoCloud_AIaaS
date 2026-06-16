# 그래프 곡선 매끄럽게 (렌더링 수정) 설계

**작성일:** 2026-06-16
**범위:** `4K_FE`의 `ClimaxGraph`·`MiniGraph` 렌더링만. 데이터/임베딩 파이프라인 불변.

---

## 1. 원인 (확정)

1. **`preserveAspectRatio="none"`**: viewBox(600×H)를 컨테이너 너비로 비균등 가로 확대 → 선 두께 불균등(가파른 곳 가늘고 완만한 곳 두꺼움) + 곡선 왜곡.
2. **중점-x 베지어**(제어점 y=양끝 y) → 점마다 수평 접선 → 계단/물결.

임베딩(z-score·스케일·savgol)은 선형/평활 연산이라 원인 아님(선 두께 불균등은 데이터로 불가능 = 렌더링 확증).

---

## 2. 해결 (최소 변경)

- **Catmull-Rom 스플라인**으로 path 생성: 이웃 점 기울기 기반 연속 접선 → 점마다 수평접선 제거 → 매끄러움. 신규 순수 함수 `catmullRomPath(points)` (`app/lib/svgPath.ts`).
- **`vectorEffect="non-scaling-stroke"`**: 곡선 stroke에 적용 → viewBox 비균등 확대에도 **선 두께 일정**. (ResizeObserver/픽셀좌표 측정 불필요 — `preserveAspectRatio="none"` 유지해도 두께 문제 해소. Catmull-Rom 곡선은 가로 확대돼도 매끄러움 유지.)

적용: ClimaxGraph 본선 path, MiniGraph 본선 path. 채움(fill) path는 동일 `d` 재사용 + 바닥 닫기. fill엔 non-scaling-stroke 불필요(stroke 없음).

---

## 3. 파일

| 파일 | 변경 |
|---|---|
| `app/lib/svgPath.ts` | 신규 — `catmullRomPath(pts: number[][]): string` (순수) |
| `app/components/ClimaxGraph.tsx` | d 생성 → `catmullRomPath(pts)`, 본선 `vectorEffect="non-scaling-stroke"` |
| `app/components/MiniGraph.tsx` | 동일 |

---

## 4. 테스트
- `catmullRomPath` 순수 함수 `npx tsx` 스폿체크(빈/단일/다점 → 'M...C...', 끝점 통과).
- `npm run build` + 수동(곡선 매끄러움·선 두께 일정).

## 5. 범위 밖
- 임베딩 파이프라인, 데이터, preserveAspectRatio 제거(픽셀좌표 렌더는 불필요해 보류).
