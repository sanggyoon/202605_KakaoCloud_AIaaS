'use client';

// 매니저 허브 — 서비스 모니터링(방문자/영화 데이터 통계) + 주요 기능 진입점.
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Stats {
  visitors: { total: number; month: number; week: number; day: number };
  movies: { total: number; with_graph: number; without_graph: number };
}

export default function ManagerPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  // backfill(신규 100개 추가) 진행 상태
  const [backfill, setBackfill] = useState<{
    running: boolean;
    processed: number;
    target: number;
    title: string | null;
    done: { added: number; failed: number } | null;
  } | null>(null);

  const fetchStats = async () => {
    setStatsLoading(true);
    try {
      const res = await fetch('/api/manager/stats', { cache: 'no-store' });
      if (!res.ok) throw new Error('stats 조회 실패');
      setStats(await res.json());
    } catch {
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  // 신규 100개 수동 추가 — CronJob과 동일한 backfill을 즉시 실행, NDJSON 진행 스트림 소비
  const runBackfill = async () => {
    if (backfill?.running) return;
    setBackfill({ running: true, processed: 0, target: 100, title: null, done: null });
    try {
      const res = await fetch('/api/manager/movies/backfill', { method: 'POST' });
      if (!res.ok || !res.body) throw new Error('backfill 시작 실패');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let doneEv: { added: number; failed: number } | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === 'progress') {
            setBackfill((s) => (s ? { ...s, processed: ev.processed, target: ev.target, title: ev.title } : s));
          } else if (ev.type === 'done') {
            doneEv = { added: ev.added, failed: (ev.failed ?? []).length };
          }
        }
      }
      setBackfill((s) => (s ? { ...s, running: false, done: doneEv ?? { added: 0, failed: 0 } } : s));
      // 새 영화가 추가됐으므로 통계 갱신
      fetchStats();
    } catch {
      setBackfill((s) => (s ? { ...s, running: false, done: { added: 0, failed: 0 } } : s));
    }
  };

  const handleLogout = async () => {
    await fetch('/api/manager/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  };

  const fmt = (n: number | undefined) =>
    statsLoading || n === undefined ? '—' : n.toLocaleString('ko-KR');

  return (
    <div style={{
      width: '100%', minHeight: '100vh',
      background: 'var(--bg)', color: 'var(--fg)',
      fontFamily: 'var(--font-sans), "Inter Tight", sans-serif',
    }}>
      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '18px 64px',
        background: 'rgba(8,9,13,0.9)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>서비스 모니터링</h1>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', color: 'var(--accent)', background: 'color-mix(in oklch, var(--accent) 14%, transparent)', padding: '3px 8px', borderRadius: 4 }}>MANAGER</span>
        </div>
        <button
          onClick={handleLogout}
          title="로그아웃"
          style={{
            padding: '8px 14px',
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: 7,
            color: 'rgb(239,120,120)',
            fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
          }}
        >
          로그아웃
        </button>
      </header>

      <main style={{ padding: '32px 64px 60px', display: 'flex', flexDirection: 'column', gap: 36 }}>
        {/* 방문자 통계 */}
        <section>
          <h2 style={sectionTitle}>방문자 통계</h2>
          <div style={cardGrid}>
            <StatCard label="누적 방문" value={fmt(stats?.visitors.total)} />
            <StatCard label="한 달 (30일)" value={fmt(stats?.visitors.month)} />
            <StatCard label="1주일 (7일)" value={fmt(stats?.visitors.week)} />
            <StatCard label="하루 (오늘)" value={fmt(stats?.visitors.day)} />
          </div>
        </section>

        {/* 영화 데이터 통계 */}
        <section>
          <h2 style={sectionTitle}>영화 데이터</h2>
          <div style={cardGrid}>
            <StatCard label="전체 영화" value={fmt(stats?.movies.total)} />
            <StatCard label="그래프 있음" value={fmt(stats?.movies.with_graph)} accent />
            <StatCard label="그래프 없음" value={fmt(stats?.movies.without_graph)} />
          </div>
        </section>

        {/* 기능 버튼 */}
        <section>
          <h2 style={sectionTitle}>기능</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            <button onClick={() => router.push('/movie_list')} style={actionBtn(false)}>
              영화 정보 리스트 →
            </button>
            <button onClick={runBackfill} disabled={backfill?.running} style={actionBtn(!!backfill?.running)}>
              {backfill?.running ? '추가 중…' : '새로운 영화 100개 추가'}
            </button>
            <button
              disabled
              title="추후 개발된 모델로 동작 예정"
              style={{ ...actionBtn(true), cursor: 'not-allowed' }}
            >
              영화 데이터 스코어링 (준비 중)
            </button>
          </div>
        </section>

        {/* Backfill 진행 배너 */}
        {backfill && (
          <div style={{ padding: '14px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
                {backfill.running
                  ? `신규 영화 추가 중… ${backfill.processed} / ${backfill.target}${backfill.title ? ` — ${backfill.title}` : ''}`
                  : `완료 — 신규 ${backfill.done?.added ?? 0}개 추가${backfill.done?.failed ? `, 실패 ${backfill.done.failed}개` : ''}`}
              </span>
              {!backfill.running && (
                <button
                  onClick={() => setBackfill(null)}
                  style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}
                >
                  닫기
                </button>
              )}
            </div>
            <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.min(100, Math.round(((backfill.running ? backfill.processed : backfill.done?.added ?? 0) / Math.max(1, backfill.target)) * 100))}%`,
                  background: backfill.running ? 'var(--accent)' : 'rgba(34,197,94,0.85)',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 12, padding: '20px 22px',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em', color: accent ? 'var(--accent)' : 'var(--fg)' }}>{value}</span>
    </div>
  );
}

const sectionTitle: React.CSSProperties = {
  margin: '0 0 14px', fontSize: 13, fontWeight: 700,
  letterSpacing: '0.08em', textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.5)',
};

const cardGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
  gap: 16,
};

function actionBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: '14px 22px',
    border: 'none', borderRadius: 10,
    background: disabled ? 'rgba(255,255,255,0.06)' : 'color-mix(in oklch, var(--accent) 20%, transparent)',
    color: disabled ? 'rgba(255,255,255,0.4)' : 'var(--accent)',
    fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
    cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap',
  };
}
