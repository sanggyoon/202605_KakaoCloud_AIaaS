'use client';

// Peakly 온보딩 튜토리얼 — 중앙 모달 캐러셀(5단계) + 단계별 자체 완결형 데모.
// 데모는 라이브 데이터를 fetch하지 않고 정적 더미/SVG로 구성한다.
import MiniGraph from './MiniGraph';

interface TutorialProps {
  step: number;
  onNext: () => void;
  onSkip: () => void;
  onComplete: () => void;
}

// 클라이맥스 곡선 더미 (arousal). 촘촘한 굴곡으로 실제 곡선 느낌.
const DEMO_AROUSAL = [
  6, 30, 14, 40, 20, 46, 26, 52, 18, 44, 33, 58, 12, 48, 30, 54,
  22, 64, 40, 78, 30, 60, 44, 88, 28, 56, 70, 95, 38, 62, 26, 50,
];
// 분위기 더미 (valence). 0~1 정규화 전 임의 스케일 — 색 흐름 표현용.
const DEMO_VALENCE = [
  2, 3, 2, 5, 3, 6, 4, 7, 3, 6, 5, 8, 3, 7, 5, 9,
  4, 8, 6, 9, 5, 7, 6, 9, 4, 7, 8, 9, 5, 7, 4, 6,
];

// 단계 메타. demo는 step 인덱스로 스위치한다(아래 렌더).
const STEPS = [
  {
    label: 'STEP 1 / 5',
    title: 'Peakly에 오신 걸 환영합니다',
    desc: '영화의 감정 흐름을 선으로 그려, 당신의 클라이맥스에 맞는 영화를 찾아드려요.',
    action: '시작하기',
  },
  {
    label: 'STEP 2 / 5',
    title: '감정을 선으로 읽다',
    desc: '높이는 감정의 고조, 색은 분위기를 나타냅니다. 어두운 분위기에서 밝은 분위기까지.',
    action: '다음',
  },
  {
    label: 'STEP 3 / 5',
    title: '원하는 조건으로 좁히기',
    desc: '제목 검색, 연도 범위, 선호·비선호 장르, 선호·비선호 영화로 추천 풀을 좁힙니다.',
    action: '다음',
  },
  {
    label: 'STEP 4 / 5',
    title: '고민될 땐 랜덤픽',
    desc: '무엇을 볼지 모르겠다면, 전체 DB에서 무작위로 한 편을 골라드려요.',
    action: '다음',
  },
  {
    label: 'STEP 5 / 5',
    title: '더 깊이: 클라이맥스 커브',
    desc: '포스터를 누르면 전체 감정 곡선과 비슷한 패턴의 영화까지 볼 수 있어요.',
    action: '시작하기',
  },
];

// 데모 영역 공통 래퍼 — 카드 안 약 150px 높이 박스
function DemoBox({ children, cap }: { children: React.ReactNode; cap?: string }) {
  return (
    <div style={{
      position: 'relative', height: 150, marginBottom: 18,
      borderRadius: 12, background: '#0a0712',
      border: '1px solid rgba(255,255,255,0.07)', overflow: 'hidden',
      display: 'grid', placeItems: 'center',
    }}>
      {children}
      {cap && (
        <div style={{
          position: 'absolute', bottom: 8, left: 0, right: 0, textAlign: 'center',
          fontSize: 8, fontWeight: 800, letterSpacing: '0.16em', color: 'rgba(255,255,255,0.38)',
        }}>{cap}</div>
      )}
    </div>
  );
}

// STEP 1 — 로고 글로우 + 태그라인
function DemoWelcome() {
  return (
    <DemoBox cap="WELCOME">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/peakly-gradient-bg.svg"
          alt="Peakly"
          width={52}
          height={52}
          style={{
            borderRadius: 14,
            filter: 'drop-shadow(0 0 28px color-mix(in oklch, var(--accent) 50%, transparent))',
          }}
        />
        <div style={{
          fontFamily: 'var(--font-serif-ko), serif', fontSize: 13, fontWeight: 700,
          color: 'rgba(255,255,255,0.85)',
        }}>한 편의 감정을 선으로 그리다</div>
      </div>
    </DemoBox>
  );
}

// STEP 2 — 그려지는 클라이맥스 곡선 (valence 색)
function DemoGraph() {
  return (
    <DemoBox cap="CLIMAX GRAPH">
      <div style={{ width: '88%', height: 92 }}>
        <MiniGraph data={DEMO_AROUSAL} valence={DEMO_VALENCE} height={92} />
      </div>
      <div style={{ position: 'absolute', left: 12, top: 12, fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,0.55)' }}>↑ 높이 = 고조</div>
      <div style={{ position: 'absolute', right: 12, top: 30, fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,0.55)' }}>색 = 분위기</div>
    </DemoBox>
  );
}

// STEP 3 — 미니 필터 데모 (검색/장르 pill)
function DemoFilters() {
  const pill = (text: string, kind: 'on' | 'no' | 'off') => {
    const map = {
      on: { bg: 'color-mix(in oklch, var(--accent) 18%, transparent)', bd: 'color-mix(in oklch, var(--accent) 45%, transparent)', fg: 'var(--accent)' },
      no: { bg: 'rgba(255,80,80,0.15)', bd: 'rgba(255,100,100,0.4)', fg: '#ff7070' },
      off: { bg: 'rgba(255,255,255,0.05)', bd: 'rgba(255,255,255,0.1)', fg: 'rgba(255,255,255,0.7)' },
    }[kind];
    return (
      <span key={text} style={{
        fontSize: 9, fontWeight: 700, padding: '4px 9px', borderRadius: 999,
        background: map.bg, border: `1px solid ${map.bd}`, color: map.fg,
      }}>{text}</span>
    );
  };
  return (
    <DemoBox cap="FILTERS">
      <div style={{ width: '86%', display: 'flex', flexDirection: 'column', gap: 9, alignItems: 'center' }}>
        <div style={{
          width: '100%', height: 22, borderRadius: 7, display: 'flex', alignItems: 'center', padding: '0 9px',
          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
          fontSize: 9, color: 'rgba(255,255,255,0.4)',
        }}>🔍 영화 제목…</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, justifyContent: 'center' }}>
          {pill('드라마', 'on')}{pill('SF', 'off')}{pill('공포', 'no')}{pill('로맨스', 'off')}
        </div>
      </div>
    </DemoBox>
  );
}

// STEP 4 — 포스터 셔플 → 한 장 확정
function DemoRandom() {
  const poster = (pick = false) => (
    <div style={{
      width: 34, aspectRatio: '2/3', borderRadius: 5,
      background: 'linear-gradient(145deg, #2a1a55, #140a30)',
      outline: pick ? '2px solid var(--accent)' : 'none',
      boxShadow: pick ? '0 0 20px color-mix(in oklch, var(--accent) 55%, transparent)' : 'none',
    }} />
  );
  return (
    <DemoBox cap="RANDOM PICK">
      <div style={{ display: 'flex', gap: 7 }}>
        {poster()}{poster()}{poster(true)}{poster()}
      </div>
    </DemoBox>
  );
}

// STEP 5 — 상세 모달(클라이맥스 커브 + 분위기 범례 + 유사영화 행)
function DemoDetail() {
  const simRow = (pct: string, name: string, meta: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ width: 30, fontSize: 16, fontWeight: 900, fontStyle: 'italic', letterSpacing: '-0.03em', flexShrink: 0 }}>{pct}<sup style={{ fontSize: 8 }}>%</sup></div>
      <div style={{ width: 20, aspectRatio: '2/3', borderRadius: 3, background: 'linear-gradient(145deg, #2a1a55, #140a30)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
        <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.4)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta}</div>
      </div>
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>›</span>
    </div>
  );
  return (
    <div style={{
      position: 'relative', marginBottom: 18, borderRadius: 12, background: '#07060e',
      border: '1px solid rgba(255,255,255,0.07)', padding: '12px 12px 11px', textAlign: 'left',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
        <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.18em', color: 'var(--accent)' }}>CLIMAX CURVE</span>
        <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.4)' }}>자막·장면 AI 분석</span>
      </div>
      <div style={{ height: 56 }}>
        <MiniGraph data={DEMO_AROUSAL} valence={DEMO_VALENCE} height={56} />
      </div>
      {/* 분위기 범례 바 */}
      <div style={{ marginTop: 7 }}>
        <div style={{ height: 6, borderRadius: 9, background: 'linear-gradient(90deg, #2dd4bf, #7b61ff, #ff6ec7)' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 6.5, color: 'rgba(255,255,255,0.45)', marginTop: 3 }}>
          <span>어두운 분위기</span><span>밝은 분위기</span>
        </div>
      </div>
      <div style={{ fontSize: 7.5, fontWeight: 800, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.5)', margin: '12px 0 6px' }}>비슷한 패턴의 영화 · 클라이맥스 유사도 기반</div>
      {simRow('48', "'고스팅' - Ghosted", '2023 · 액션 · 코미디 · 중반 정점의 산형 곡선')}
      {simRow('43', '캐스트 어웨이', '2000 · 모험 · 드라마 · 초반부터 달아오르는 곡선')}
    </div>
  );
}

export default function Tutorial({ step, onNext, onSkip, onComplete }: TutorialProps) {
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const demo = [
    <DemoWelcome key="w" />,
    <DemoGraph key="g" />,
    <DemoFilters key="f" />,
    <DemoRandom key="r" />,
    <DemoDetail key="d" />,
  ][step];

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 40 }}
      />

      {/* Modal */}
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        zIndex: 41, width: 'min(344px, calc(100vw - 32px))',
        background: 'linear-gradient(160deg, rgba(22,18,40,0.98) 0%, rgba(10,9,18,0.98) 100%)',
        border: '1px solid rgba(123,97,255,0.22)', borderRadius: 18,
        padding: '26px 22px 22px',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 60px color-mix(in oklch, var(--accent) 10%, transparent)',
        animation: 'fadeIn 0.22s ease', textAlign: 'center',
      }}>
        {/* Step label */}
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.2em', color: 'var(--accent)', marginBottom: 12 }}>
          {current.label}
        </div>

        {/* Title */}
        <h2 style={{ margin: '0 0 9px', fontSize: 19, fontWeight: 800, letterSpacing: '-0.02em' }}>
          {current.title}
        </h2>

        {/* Description */}
        <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'rgba(255,255,255,0.58)', lineHeight: 1.6 }}>
          {current.desc}
        </p>

        {/* Demo */}
        {demo}

        {/* Progress dots */}
        <div style={{ display: 'flex', gap: 5, justifyContent: 'center', marginBottom: 16 }}>
          {STEPS.map((_, i) => (
            <span key={i} style={{
              width: i === step ? 18 : 6, height: 6, borderRadius: 9,
              background: i === step ? 'var(--accent)' : 'rgba(255,255,255,0.2)',
              transition: 'width 0.2s, background 0.2s',
            }} />
          ))}
        </div>

        {/* Footer buttons */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <button
            onClick={onSkip}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.4)', fontSize: 13, fontWeight: 500,
              padding: '4px 8px', fontFamily: 'inherit',
            }}
          >스킵</button>
          <button
            onClick={isLast ? onComplete : onNext}
            style={{
              flex: 1, padding: '13px 20px', background: 'var(--accent)',
              border: 'none', borderRadius: 10, color: 'black', fontSize: 14, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
              boxShadow: '0 4px 20px color-mix(in oklch, var(--accent) 30%, transparent)',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.88'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
          >{current.action}</button>
        </div>
      </div>
    </>
  );
}
