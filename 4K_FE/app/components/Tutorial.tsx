'use client';

// 튜토리얼 오버레이 — 3단계 가이드, step 1~2에서는 헤더를 spotlight로 강조
interface TutorialProps {
  step: number;
  onNext: () => void;
  onSkip: () => void;
  onComplete: () => void;
}

const STEPS = [
  {
    label: 'TUTORIAL 1 / 3',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="var(--accent)">
        <path d="M12 2.5C12 2.5 12.8 7.6 14.5 9.5C16.4 11.2 21.5 12 21.5 12C21.5 12 16.4 12.8 14.5 14.5C12.8 16.4 12 21.5 12 21.5C12 21.5 11.2 16.4 9.5 14.5C7.6 12.8 2.5 12 2.5 12C2.5 12 7.6 11.2 9.5 9.5C11.2 7.6 12 2.5 12 2.5Z" />
      </svg>
    ),
    title: '4K Cinema 시작하기',
    desc: '영화의 클라이맥스 흐름을 분석하는 새로운 추천 엔진을 경험해 보세요.',
    action: '튜토리얼 시작',
    highlight: false,
  },
  {
    label: 'TUTORIAL 2 / 3',
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.2"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" strokeLinecap="round" />
      </svg>
    ),
    title: '1. 맞춤 필터링',
    desc: '검색창과 필터 버튼으로 연도, 장르를 자유롭게 조절하세요.',
    action: '다음',
    highlight: true,
  },
  {
    label: 'TUTORIAL 3 / 3',
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.2"
      >
        <path
          d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
    title: '2. 랜덤 추천',
    desc: '무엇을 볼지 고민될 때 랜덤 픽 버튼을 눌러보세요.',
    action: '시작하기',
    highlight: true,
  },
];

export default function Tutorial({
  step,
  onNext,
  onSkip,
  onComplete,
}: TutorialProps) {
  const current = STEPS[step] ?? STEPS[0];
  const isHeaderStep = step === 1 || step === 2;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.72)',
          zIndex: 40,
          clipPath: isHeaderStep
            ? 'polygon(0 73px, 100% 73px, 100% 100%, 0% 100%)'
            : undefined,
        }}
      />

      {/* Modal */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 41,

          width: 'clamp(320px, 42vw, 460px)',
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',

          background:
            'linear-gradient(160deg, rgba(22,18,40,0.98) 0%, rgba(10,9,18,0.98) 100%)',
          border: '1px solid rgba(123,97,255,0.2)',
          borderRadius: 'clamp(16px, 2vw, 22px)',
          padding: 'clamp(22px, 3vw, 36px)',

          boxShadow:
            '0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(123,97,255,0.08), 0 0 60px color-mix(in oklch, var(--accent) 10%, transparent)',
          animation: 'fadeIn 0.22s ease',
          textAlign: 'center',
        }}
      >
        {/* Step label */}
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.2em',
            color: 'var(--accent)',
            marginBottom: 'clamp(12px, 2vw, 16px)',
          }}
        >
          {current.label}
        </div>

        {/* Icon + Title */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            marginBottom: 'clamp(10px, 2vw, 14px)',
          }}
        >
          {current.icon}

          <h2
            style={{
              margin: 0,
              fontSize: 'clamp(18px, 2vw, 24px)',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              lineHeight: 1.25,
            }}
          >
            {current.title}
          </h2>
        </div>

        {/* Description */}
        <p
          style={{
            margin: '0 0 clamp(20px, 3vw, 28px)',
            fontSize: 'clamp(13px, 1.4vw, 15px)',
            color: 'rgba(255,255,255,0.6)',
            lineHeight: 1.65,
          }}
        >
          {current.desc}
        </p>

        {/* Footer buttons */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto minmax(0, 1fr)',
            alignItems: 'center',
            gap: 'clamp(10px, 2vw, 14px)',
          }}
        >
          <button
            onClick={onSkip}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'rgba(255,255,255,0.4)',
              fontSize: 'clamp(12px, 1.3vw, 13px)',
              fontWeight: 500,
              padding: '4px 8px',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
            }}
          >
            스킵
          </button>

          <button
            onClick={step === STEPS.length - 1 ? onComplete : onNext}
            style={{
              width: '100%',
              padding:
                'clamp(12px, 1.6vw, 15px) clamp(16px, 2vw, 24px)',
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 'clamp(10px, 1.4vw, 14px)',
              color: 'black',
              fontSize: 'clamp(13px, 1.4vw, 15px)',
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
              boxShadow:
                '0 4px 20px color-mix(in oklch, var(--accent) 30%, transparent)',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '0.88';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '1';
            }}
          >
            {current.action}
          </button>
        </div>
      </div>
    </>
  );
}