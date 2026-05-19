'use client';

// 온보딩 랜딩 페이지 — 서비스 소개 후 /dashboard로 진입시키는 진입점
import { useRouter } from 'next/navigation';
import BackgroundThread from '@/app/components/BackgroundThread';

const FEATURES = [
  {
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth="2.2"
      >
        <path
          d="M22 12h-4l-3 9L9 3l-3 9H2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
    title: '도파민 흐름 분석',
    desc: '자막 데이터를 AI로 분석하여 영화의 긴장감 곡선과 클라이맥스를 시각화합니다.',
  },
  {
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth="2.2"
      >
        <polyline
          points="23 6 13.5 15.5 8.5 10.5 1 18"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          points="17 6 23 6 23 12"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
    title: '클라이맥스 매칭',
    desc: '당신의 현재 기분과 완벽하게 맞아 떨어지는 가장 짜릿한 절정의 영화를 찾아냅니다.',
  },
  {
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth="2.2"
      >
        <polygon points="5 3 19 12 5 21 5 3" strokeLinejoin="round" />
      </svg>
    ),
    title: '즉시 몰입 셔플',
    desc: '무엇을 볼지 고민되나요? 애니메이션과 함께 최적의 영화를 단 1초 만에 픽해드립니다.',
  },
];

export default function OnboardingPage() {
  const router = useRouter();

  return (
    <div
      style={{
        width: '100%',
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--fg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-sans), "Inter Tight", sans-serif',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* BackgroundThread — WebGL 실 애니메이션 배경 */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
        <BackgroundThread
          color={[0.482, 0.38, 1]}
          amplitude={1.5}
          distance={0.3}
          enableMouseInteraction
        />
      </div>

      {/* Ambient spotlight */}
      <div
        style={{
          position: 'absolute',
          top: -200,
          left: '50%',
          transform: 'translateX(-50%)',
          width: '90%',
          height: 600,
          background:
            'radial-gradient(ellipse at top, color-mix(in oklch, var(--accent) 14%, transparent) 0%, transparent 65%)',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          textAlign: 'center',
          padding: '40px 24px',
          maxWidth: 720,
          width: '100%',
        }}
      >
        {/* Logo icon */}
        <img
          src="/peakly-gradient-bg.svg"
          alt="Peakly"
          width={80}
          height={80}
          style={{
            display: 'block',
            margin: '0 auto 32px',
            borderRadius: 20,
            filter:
              'drop-shadow(0 0 40px color-mix(in oklch, var(--accent) 40%, transparent))',
          }}
        />

        {/* Title */}
        <h1
          style={{
            fontSize: 'clamp(38px, 9vw, 60px)',
            fontWeight: 900,
            margin: '0 0 10px',
            letterSpacing: '-0.04em',
            lineHeight: 1,
          }}
        >
          Peakly
        </h1>
        <p
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.22em',
            color: 'var(--accent)',
            margin: '0 0 52px',
          }}
        >
          CLIMAX-BASED RECOMMENDATION
        </p>

        {/* Feature cards */}
        <div className="feature-grid">
          {FEATURES.map((card) => (
            <div
              key={card.title}
              style={{
                background: 'rgba(255,255,255,0.025)',
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: 16,
                padding: '28px 20px',
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  background:
                    'color-mix(in oklch, var(--accent) 20%, transparent)',
                  display: 'grid',
                  placeItems: 'center',
                  margin: '0 auto 16px',
                }}
              >
                {card.icon}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
                {card.title}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: 'rgba(255,255,255,0.48)',
                  lineHeight: 1.7,
                }}
              >
                {card.desc}
              </div>
            </div>
          ))}
        </div>

        {/* CTA button */}
        <button
          onClick={() => router.push('/dashboard')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '16px 44px',
            fontSize: 16,
            fontWeight: 700,
            background: 'var(--accent)',
            color: 'black',
            border: 'none',
            borderRadius: 12,
            cursor: 'pointer',
            fontFamily: 'inherit',
            boxShadow:
              '0 0 40px color-mix(in oklch, var(--accent) 30%, transparent)',
            transition: 'opacity 0.15s, transform 0.15s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.opacity = '0.88';
            (e.currentTarget as HTMLButtonElement).style.transform =
              'translateY(-1px)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.opacity = '1';
            (e.currentTarget as HTMLButtonElement).style.transform =
              'translateY(0)';
          }}
        >
          시작하기
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
