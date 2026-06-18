# 모바일 클라이맥스 그래프 — 높이 축소 + 스크럽 슬라이더 설계

작성일: 2026-06-18
상태: 설계 승인됨

## 목적

상세 오버레이의 클라이맥스 그래프(`ClimaxGraph`)가 모바일에서 너무 높아(데스크탑과
동일한 380px) 삐죽거리고 영화의 흐름이 안 읽힌다. 또한 데스크탑은 호버로 상세
정보(진행도/피크/분위기)가 보이지만 모바일은 탭에 의존해 정밀 조정이 어렵다.

두 가지를 해결한다:
1. **모바일 그래프 높이를 210px로 축소**(데스크탑 380은 유지) → 흐름이 읽히게.
2. **모바일 전용 스크럽 슬라이더**를 그래프 하단에 추가 → 손가락으로 드래그하면
   데스크탑 호버와 동일한 상세 정보가 그래프를 따라 이동. 손을 떼면 잠시 후 사라짐.

## 배경 / 확정 사실

- `4K_FE/app/components/ClimaxGraph.tsx`:
  - SVG `viewBox="0 0 600 H"`, `H = height`(prop, 기본 380). `padY=64`, 곡선은
    `innerH = H - 128`에 min-max 정규화되어 그려진다. 높이를 줄이면 곡선이 가로로
    눕혀져 덜 삐죽해진다.
  - 상호작용 상태는 `hover: number | null`(scene 인덱스). 데스크탑 `onMouseMove`가
    `setHover`를 호출하고, 이 값으로 십자선·마커·툴팁(진행도/피크/분위기)을 그린다.
  - 마운트 wipe 애니메이션용 `drawn` 상태가 이미 있다.
  - 파생값: `progress`(진행도 %), `peakPct`(피크 %), `moodU`/`moodColor`/`moodLabel`
    (분위기), `hx`/`hy`(마커 좌표 %).
- `4K_FE/app/components/DetailOverlay.tsx`: 그래프 컨테이너 `<div style={{ height: 380,
  overflow: 'hidden', ... }}>` 안에 `<ClimaxGraph data=... valence=... height={380} />`를
  렌더한다. 로딩/없음 상태는 `display: grid`로 placeholder를 가운데 배치.
- 모바일 감지: `4K_FE/app/components/Tutorial.tsx`에 `matchMedia` 사용 선례가 있다.
- 코드 작성 전 `4K_FE/node_modules/next/dist/docs/` 확인 (커스텀 Next — `AGENTS.md`).
- 테스트 러너 없음 → 검증은 `npx tsc --noEmit`, `npx eslint <변경파일>`, `npm run build`
  + dev 모바일 뷰포트 수동 확인.

## 상세 설계

### ① 반응형 높이 (`ClimaxGraph.tsx`)

- 컴포넌트 내부에서 모바일 여부를 감지:
  ```ts
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  ```
- 유효 높이: `const H = isMobile ? 210 : height;`. (데스크탑은 prop 380 그대로.)
- `DetailOverlay`의 그래프 컨테이너는 그래프가 렌더될 때 높이를 그래프에 맞춘다:
  벡터가 있으면 `height: 'auto'`(그래프가 자기 높이를 차지), 로딩/없음일 때만
  placeholder용 고정 높이(`minHeight`)를 둔다. 모바일에선 슬라이더 높이만큼 더해진다.

### ② 모바일 스크럽 슬라이더 (그래프 하단)

- **데스크탑(비모바일)**: 슬라이더 미렌더, 기존 `onMouseMove` 호버 그대로.
- **모바일**: 그래프 SVG 아래에 전용 슬라이더(트랙 + thumb)를 렌더.
  - 트랙은 전체 폭. 위치 `0~1` → scene 인덱스 `Math.round(f * (data.length - 1))`로
    매핑해 `setHover(index)` 호출 → 그래프의 십자선·마커·툴팁이 따라 이동.
  - **드래그와 탭 모두** 스크럽: `pointerdown`/`pointermove`/`pointerup`(Pointer
    Events, 터치·마우스 통합)로 트랙 기준 상대 x를 계산.
    ```ts
    const onScrub = (clientX: number, trackEl: HTMLElement) => {
      const rect = trackEl.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      setHover(Math.round(f * (data.length - 1)));
    };
    ```
  - thumb는 현재 스크럽 위치(`hover` 비율)에 배치하고, 색은 해당 지점의 valence
    색(`moodColor`)을 따라가게 해 시각적으로 연결.
  - 표시 정보는 데스크탑 호버와 **동일**: 진행도 %, 피크 %, 분위기(색+라벨). 기존
    툴팁 마크업을 그대로 사용(분기 없이 `hover`가 set이면 표시).

### ③ 정보 표시/페이드 동작

- 스크럽 중(`pointerdown`~`pointermove`): `hover` set → 정보 항상 표시.
- 손을 떼면(`pointerup`/`pointercancel`): 즉시 지우지 않고
  - **약 1.2초 유지** 후 **0.4초에 걸쳐 페이드아웃** → 그 다음 `setHover(null)`.
  - 구현: `fading` 상태 + 툴팁/십자선/마커에 `opacity` 트랜지션(0.4s). 타이머
    1.2초 후 `setFading(true)`, 트랜지션 종료 시 `hover`/`fading` 초기화.
  - 페이드 진행 중 재터치하면 타이머를 취소하고 `fading=false`로 즉시 복귀.
  - 데스크탑 호버 경로에는 페이드 로직을 적용하지 않는다(`onMouseLeave`는 기존대로
    즉시 `setHover(null)`).

### ④ 영향 범위 / 경계

- `ClimaxGraph.tsx`: isMobile 감지, 유효 높이, 슬라이더 렌더·핸들러, 페이드 타이머
  추가. 기존 호버/툴팁/wipe는 보존.
- `DetailOverlay.tsx`: 그래프 컨테이너 높이를 반응형으로(그래프 렌더 시 auto).
- 데이터 흐름·응답 형식·다른 컴포넌트 변경 없음.

## 범위 밖 (YAGNI)

- 데스크탑 슬라이더(데스크탑은 호버 유지).
- 그래프 자체를 손가락으로 직접 드래그(손가락이 데이터를 가려 정밀 조정 어려움 —
  하단 슬라이더로 대체하는 게 이번 목적).
- 핀치 줌, 다중 마커, 구간 선택 등.

## 검증

- `npx tsc --noEmit` (변경 파일 에러 없음)
- `npx eslint app/components/ClimaxGraph.tsx app/components/DetailOverlay.tsx`
  (변경 파일 클린 — 기존 pre-existing 에러 제외)
- `npm run build` 성공
- dev 모바일 뷰포트(≤639px): 그래프 높이 210, 하단 슬라이더 드래그/탭 → 마커+정보
  이동(진행도/피크/분위기 일치), 손 떼면 ~1.2s 후 페이드아웃, 재터치 시 즉시 복귀.
  데스크탑: 기존 호버 동작·380px 유지.
