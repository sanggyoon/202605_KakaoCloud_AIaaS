'use client';

// 매니저 페이지 로그인 — env 기반 ID/비밀번호 인증 + agami 캡챠(테스트·비차단).
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';

const AGAMI_SITEKEY = process.env.NEXT_PUBLIC_AGAMI_SITEKEY || '';

declare global {
  interface Window {
    onCaptchaToken?: (token: string) => void;
    onCaptchaError?: (info: unknown) => void;
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');

  useEffect(() => {
    window.onCaptchaToken = (token: string) => setCaptchaToken(token);
    window.onCaptchaError = () => setCaptchaToken('');
    return () => {
      window.onCaptchaToken = undefined;
      window.onCaptchaError = undefined;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/manager/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, password, captchaToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail ?? '로그인에 실패했습니다.');
        return;
      }
      // SECURITY(의도됨): 캡챠 실패 시에도 차단하지 않고 **무조건 매니저로 진입**한다.
      // 테스트 도입 단계라 alert로 알리기만 함(접근 게이트는 ID/비밀번호). 취약점 아님 — 설계상 비차단.
      if (data.captcha === 'failed') {
        alert('캡챠 인증에 실패했습니다. (테스트)');
      }
      // 원래 가려던 목적지(next)로 복귀, 없으면 매니저 페이지로
      const next = new URLSearchParams(window.location.search).get('next');
      router.replace(next && next.startsWith('/') ? next : '/manager');
      router.refresh();
    } catch {
      setError('로그인 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'grid', placeItems: 'center',
      background: 'var(--bg)', color: 'var(--fg)',
      fontFamily: 'var(--font-sans), "Inter Tight", sans-serif',
      padding: 20,
    }}>
      {AGAMI_SITEKEY && (
        <Script src="https://agami-captcha.cloud/widget/loader.js" strategy="afterInteractive" />
      )}
      <form
        onSubmit={handleSubmit}
        style={{
          width: '100%', maxWidth: 360,
          display: 'flex', flexDirection: 'column', gap: 18,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 14, padding: '32px 28px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>영화 관리</h1>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', color: 'var(--accent)', background: 'color-mix(in oklch, var(--accent) 14%, transparent)', padding: '3px 8px', borderRadius: 4 }}>MANAGER</span>
        </div>
        <p style={{ margin: '-8px 0 0', fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
          로그인이 필요한 페이지입니다.
        </p>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>ID</span>
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            autoFocus
            autoComplete="username"
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>비밀번호</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            style={inputStyle}
          />
        </label>

        {AGAMI_SITEKEY && (
          <div
            className="agami-captcha"
            data-sitekey={AGAMI_SITEKEY}
            data-kind="flashlight"
            data-callback="onCaptchaToken"
            data-error-callback="onCaptchaError"
          />
        )}

        {error && (
          <div style={{ fontSize: 12, color: 'rgb(248,113,113)' }}>{error}</div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            marginTop: 4, padding: '10px 0', border: 'none', borderRadius: 8,
            background: 'color-mix(in oklch, var(--accent) 22%, transparent)',
            color: 'var(--accent)', fontSize: 13, fontWeight: 700,
            fontFamily: 'inherit', cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.5 : 1,
          }}
        >
          {loading ? '로그인 중...' : '로그인'}
        </button>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '10px 12px',
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8, color: 'var(--fg)',
  fontSize: 13, fontFamily: 'inherit', outline: 'none',
};
