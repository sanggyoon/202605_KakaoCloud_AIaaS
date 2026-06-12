'use client';

// 온보딩 랜딩 페이지 — 서비스 소개 후 /dashboard로 진입시키는 진입점
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { logVisit } from '@/app/lib/data';
import BackgroundThread from '@/app/components/BackgroundThread';

export default function OnboardingPage() {
  const router = useRouter();

  useEffect(() => {
    logVisit();
  }, []);

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

        {/* 서비스 태그라인 — 세리프 + 단어 순차 등장 + 핵심어 글로우 */}
        <p
          style={{
            fontSize: 'clamp(20px, 4.4vw, 30px)',
            fontWeight: 700,
            lineHeight: 1.5,
            color: 'rgba(255,255,255,0.9)',
            margin: '0 auto 52px',
            maxWidth: 560,
            letterSpacing: '-0.01em',
            fontFamily: 'var(--font-serif-ko), serif',
          }}
        >
          <span className="tagline-word" style={{ animationDelay: '0.1s' }}>한 편의 </span>
          <span className="tagline-word" style={{ animationDelay: '0.35s' }}>
            <em className="tagline-key">감정</em>을{' '}
          </span>
          <span className="tagline-word" style={{ animationDelay: '0.6s' }}>
            <em className="tagline-key">데이터</em>로{' '}
          </span>
          <span className="tagline-word" style={{ animationDelay: '0.85s' }}>그리다</span>
        </p>

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
