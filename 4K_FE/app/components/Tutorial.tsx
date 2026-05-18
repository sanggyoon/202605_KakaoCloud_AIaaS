'use client';

// 튜토리얼 오버레이 — 4단계 가이드, step 1~2에서는 헤더를 spotlight로 강조
import { useState } from 'react';
import MiniGraph from './MiniGraph';

interface TutorialProps {
  step: number;
  onNext: () => void;
  onSkip: () => void;
  onComplete: () => void;
}

// 클라이맥스 그래프 체험용 더미 데이터
const DEMO_GRAPH = [8, 18, 12, 28, 22, 48, 42, 68, 58, 82, 78, 95, 72, 84, 62, 48, 36, 28];

const STEPS = [
  {
    label: 'TUTORIAL 1 / 4',
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
    label: 'TUTORIAL 2 / 4',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2">
        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" strokeLinecap="round" />
      </svg>
    ),
    title: '1. 맞춤 필터링',
    desc: '검색창과 필터 버튼으로 연도, 장르를 자유롭게 조절하세요.',
    action: '다음',
    highlight: true,
  },
  {
    label: 'TUTORIAL 3 / 4',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2">
        <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    title: '2. 랜덤 추천',
    desc: '무엇을 볼지 고민될 때 랜덤 픽 버튼을 눌러보세요.',
    action: '다음',
    highlight: true,
  },
  {
    label: 'TUTORIAL 4 / 4',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    ),
    title: '3. 클라이맥스 그래프',
    desc: '아래 포스터에 마우스를 올려 그래프가 나타나는지 확인해 보세요!',
    action: '체험 완료, 시작하기',
    highlight: false,
  },
];

export default function Tutorial({ step, onNext, onSkip, onComplete }: TutorialProps) {
  const [cardHovered, setCardHovered] = useState(false);
  const current = STEPS[step];
  const isHeaderStep = step === 1 || step === 2;

  return (
    <>
      {/* Backdrop — 헤더 강조 step에서는 clipPath로 상단 73px(헤더 높이)를 잘라내 헤더만 노출 */}
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
          top: isHeaderStep ? '50%' : '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 41,
          width: 360,
          background: 'linear-gradient(160deg, rgba(22,18,40,0.98) 0%, rgba(10,9,18,0.98) 100%)',
          border: '1px solid rgba(123,97,255,0.2)',
          borderRadius: 18,
          padding: '32px 28px 28px',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(123,97,255,0.08), 0 0 60px color-mix(in oklch, var(--accent) 10%, transparent)',
          animation: 'fadeIn 0.22s ease',
          textAlign: 'center',
        }}
      >
        {/* Step label */}
        <div style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.2em',
          color: 'var(--accent)',
          marginBottom: 14,
        }}>
          {current.label}
        </div>

        {/* Icon + Title */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
          {current.icon}
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em' }}>
            {current.title}
          </h2>
        </div>

        {/* Description */}
        <p style={{
          margin: '0 0 24px',
          fontSize: 13,
          color: 'rgba(255,255,255,0.6)',
          lineHeight: 1.65,
        }}>
          {current.desc}
        </p>

        {/* 마지막 step에서만 렌더링되는 클라이맥스 그래프 체험 카드 */}
        {step === 3 && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
            <div
              onMouseEnter={() => setCardHovered(true)}
              onMouseLeave={() => setCardHovered(false)}
              style={{
                width: 130,
                aspectRatio: '2/3',
                borderRadius: 10,
                background: 'linear-gradient(145deg, #3a1070 0%, #1a0545 60%, #0d0228 100%)',
                overflow: 'hidden',
                position: 'relative',
                cursor: 'pointer',
                boxShadow: cardHovered
                  ? '0 0 40px color-mix(in oklch, var(--accent) 45%, transparent), 0 8px 30px rgba(0,0,0,0.6)'
                  : '0 8px 24px rgba(0,0,0,0.5)',
                transition: 'box-shadow 0.3s',
              }}
            >
              {/* hover 전 상태 */}
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
                opacity: cardHovered ? 0 : 1,
                transition: 'opacity 0.25s',
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="rgba(255,255,255,0.7)">
                  <path d="M4 0L4 18L8.5 14.5L11.5 21L13.5 20L10.5 13.5L16 13.5Z" />
                </svg>
                <span style={{ color: 'white', fontWeight: 700, fontSize: 13 }}>Hover Me!</span>
              </div>

              {/* hover 시 클라이맥스 그래프 표시 */}
              <div style={{
                position: 'absolute', inset: 0,
                background: 'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.88) 55%)',
                opacity: cardHovered ? 1 : 0,
                transition: 'opacity 0.3s',
                display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
                padding: '0 12px 14px',
              }}>
                <div style={{
                  fontSize: 8, fontWeight: 700, letterSpacing: '0.16em',
                  color: 'rgba(255,255,255,0.5)', marginBottom: 5,
                }}>
                  CLIMAX GRAPH
                </div>
                <div style={{ height: 55 }}>
                  <MiniGraph data={DEMO_GRAPH} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer buttons */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <button
            onClick={onSkip}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.4)', fontSize: 13, fontWeight: 500,
              padding: '4px 8px', fontFamily: 'inherit',
            }}
          >
            스킵
          </button>
          <button
            onClick={step === STEPS.length - 1 ? onComplete : onNext}
            style={{
              flex: 1,
              padding: '13px 20px',
              background: 'var(--accent)',
              border: 'none', borderRadius: 10,
              color: 'black', fontSize: 14, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
              boxShadow: '0 4px 20px color-mix(in oklch, var(--accent) 30%, transparent)',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.88'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
          >
            {current.action}
          </button>
        </div>
      </div>
    </>
  );
}
