# 매니저 레이아웃 리파인 설계

**작성일:** 2026-06-16
**범위:** `4K_FE/app/manager/page.tsx` 시각 리파인 (FE만, 로직/엔드포인트 불변).

---

## 변경 항목

1. **기간 방문자 결과 = 큰 숫자 카드**: 날짜 2개 + "기간 방문자" 버튼은 컨트롤 카드에 두고, **결과는 오른쪽 별도 카드**에 큰 숫자로(값=`{N}`, 캡션=`{시작}~{종료}`). 미조회 시 `—`.
2. **처리 현황**:
   - 상단에 **전체 영화 개수** 표시 = `stats.processing.subtitle_state`의 값 합(=처리 대상 총 영화 수). 라벨 "전체 영화 N개".
   - 리스트가 패널 높이를 **꽉 채우게**(하단 빈 공간 제거): 내부 리스트 `flex:1` + 행 간 `justify-content: space-between`으로 분산.
3. **바로가기**:
   - **Understand Everything** 추가 → `https://understand.peakly.art`, 설명 "코드베이스 지식 그래프".
   - **Argo Workflow URL 수정**: `workflow.peakly.art` → **`workflows.peakly.art`**.
4. **카드 대비 향상**: 카드 배경이 페이지 배경과 너무 비슷 → 배경/테두리를 살짝 밝게. 공용 `card`·`StatCard`·`LinkRow`·처리현황 칩에 적용(배경 `rgba(255,255,255,0.02→0.045)`, 테두리 `0.06→0.10` 수준).

---

## 구현 메모

- 전체 영화 수: `Object.values(stats?.processing?.subtitle_state ?? {}).reduce((a,b)=>a+b,0)` (FE 계산, BE 불변).
- 방문자 행: cardGrid에 [4 stat + 컨트롤 카드 + 결과(큰숫자) 카드]. 결과 카드는 `StatCard` 스타일 재사용(label=기간, value=`{N}명` 또는 `—`).
- 처리현황 패널: `card`에 `height:100%`/flex 컬럼, 리스트 `flex:1` + `justifyContent:'space-between'`.
- 색 밝기: 공용 스타일 const 값만 조정(전역 일관). 과하지 않게 한 단계만.

## 테스트
- `npm run build` + 수동(대비·큰숫자·처리현황 꽉참·링크 6→7개·workflows URL).

## 범위 밖
- BE/데이터/로직, 다른 페이지.
