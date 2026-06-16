'use client';

// 매니저 허브 — 서비스 모니터링(방문자/영화 데이터 통계) + 주요 기능 진입점.
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Stats {
  visitors: { total: number; month: number; week: number; day: number };
  processing: Record<string, Record<string, number>>;
}

// vm5 processing_status 단계 + 상태값 표시 라벨
const PROC_STAGES: { key: string; label: string }[] = [
  { key: 'subtitle_state', label: '자막 수집' },
  { key: 'parse_state', label: '파싱' },
  { key: 'label_state', label: 'LLM 라벨링' },
  { key: 'score_state', label: '스코어링' },
  { key: 'vector_state', label: '벡터 생성' },
];
const STATE_LABELS: Record<string, string> = {
  done: '완료', failed: '실패', skipped: '스킵', pending: '대기',
};
const STATE_BG: Record<string, string> = {
  done: 'rgba(45,212,191,0.12)',
  failed: 'rgba(255,95,162,0.14)',
  skipped: 'rgba(255,255,255,0.04)',
  pending: 'rgba(123,97,255,0.12)',
};

// BE 잡 레지스트리 상태 + 폴링용 running 플래그
interface Job {
  state: 'idle' | 'running' | 'done' | 'failed';
  running: boolean;
  processed: number;
  target: number;
  added: number;
  skipped: number;
  failed: number[];
  log: string[];
  error: string | null;
}

function _failedJob(error: string): Job {
  return { state: 'failed', running: false, processed: 0, target: 0,
    added: 0, skipped: 0, failed: [], log: [], error };
}

// 백그라운드 잡 시작 후 GET /api/manager/jobs/{type}를 폴링 — backfill·collect 공통
async function startAndPoll(
  startUrl: string,
  jobType: string,
  setJob: React.Dispatch<React.SetStateAction<Job | null>>,
  onDone?: () => void,
) {
  try {
    const res = await fetch(startUrl, { method: 'POST' });
    if (!res.ok) throw new Error(`시작 실패 (${res.status})`);
    const data = await res.json();
    setJob({ ...data, running: data.state === 'running' });
  } catch (e) {
    setJob(_failedJob(String(e)));
    return;
  }
  const poll = setInterval(async () => {
    try {
      const r = await fetch(`/api/manager/jobs/${jobType}`, { cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      const running = data.state === 'running';
      setJob({ ...data, running });
      if (!running) {
        clearInterval(poll);
        onDone?.();
      }
    } catch {
      /* 폴링 일시 실패는 무시하고 다음 틱에 재시도 */
    }
  }, 1500);
}

function JobBanner({ job, label, onClose }: { job: Job; label: string; onClose: () => void }) {
  const pct = Math.min(100, Math.round((job.processed / Math.max(1, job.target)) * 100));
  const barColor = job.state === 'failed'
    ? 'rgba(239,68,68,0.85)'
    : job.running ? 'var(--accent)' : 'rgba(34,197,94,0.85)';
  return (
    <div style={{ padding: '14px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
          {job.running
            ? `${label} 중… ${job.processed} / ${job.target}`
            : job.state === 'failed'
              ? `${label} 실패`
              : `${label} 완료 — 신규 ${job.added} · 스킵 ${job.skipped} · 실패 ${job.failed.length}`}
        </span>
        {!job.running && (
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
            닫기
          </button>
        )}
      </div>
      <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: barColor, transition: 'width 0.3s ease' }} />
      </div>
      {job.error && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'rgb(239,120,120)' }}>에러: {job.error}</div>
      )}
      {job.log.length > 0 && (
        <pre style={{
          marginTop: 8, maxHeight: 180, overflow: 'auto',
          background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8,
          padding: 10, fontSize: 11, lineHeight: 1.5, color: 'rgba(255,255,255,0.6)',
          fontFamily: 'var(--font-mono, monospace)', whiteSpace: 'pre-wrap',
        }}>
          {job.log.slice(-200).join('\n')}
        </pre>
      )}
    </div>
  );
}

export default function ManagerPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  // backfill(영화 수집) / collect(자막 수집) 진행 상태
  const [backfill, setBackfill] = useState<Job | null>(null);
  const [collect, setCollect] = useState<Job | null>(null);
  // 영화 수집 개수
  const [backfillN, setBackfillN] = useState(100);
  // 자막 수집 가능한(종료 상태 아닌) 영화 수 + 입력 개수
  const [remaining, setRemaining] = useState<number | null>(null);
  const [collectN, setCollectN] = useState(50);
  const [activeModel, setActiveModel] = useState<{ version: string; metrics: Record<string, number> } | null>(null);
  const _today = new Date().toISOString().slice(0, 10);
  const _monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [vStart, setVStart] = useState(_monthAgo);
  const [vEnd, setVEnd] = useState(_today);
  const [rangeCount, setRangeCount] = useState<number | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);

  const fetchRange = async () => {
    if (vStart > vEnd) return;
    setRangeLoading(true);
    try {
      const res = await fetch(`/api/manager/visits/range?start=${vStart}&end=${vEnd}`, { cache: 'no-store' });
      const d = await res.json();
      setRangeCount(typeof d.count === 'number' ? d.count : null);
    } catch {
      setRangeCount(null);
    } finally {
      setRangeLoading(false);
    }
  };

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

  const fetchRemaining = async () => {
    try {
      const res = await fetch('/api/manager/subtitles/remaining', { cache: 'no-store' });
      if (!res.ok) throw new Error('remaining 조회 실패');
      const data = await res.json();
      setRemaining(typeof data.remaining === 'number' ? data.remaining : null);
    } catch {
      setRemaining(null);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchRemaining();
    fetch('/api/manager/active-model', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setActiveModel(d))
      .catch(() => {});
  }, []);

  // 영화 수집 — 입력한 개수만큼 백그라운드 잡 시작 후 폴링
  const runBackfill = () => {
    if (backfill?.running) return;
    const n = Math.max(1, Math.min(backfillN, 2000));
    startAndPoll(`/api/manager/movies/backfill?limit=${n}`, 'movie', setBackfill, fetchStats);
  };

  // 자막 수집 — 입력한 개수만큼 백그라운드 잡 시작 후 폴링
  const runCollect = () => {
    if (collect?.running) return;
    const n = Math.max(1, Math.min(collectN, remaining ?? collectN));
    startAndPoll(`/api/manager/subtitles/collect?limit=${n}`, 'subtitle', setCollect, () => {
      fetchStats();
      fetchRemaining();
    });
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

      <main style={{ padding: '32px 64px 60px', display: 'flex', flexDirection: 'column', gap: 28 }}>
        {/* 1) 방문자 + 기간 조회 */}
        <section>
          <h2 style={sectionTitle}>방문자</h2>
          <div style={cardGrid}>
            <StatCard label="누적 방문" value={fmt(stats?.visitors.total)} />
            <StatCard label="30일 방문" value={fmt(stats?.visitors.month)} />
            <StatCard label="7일 방문" value={fmt(stats?.visitors.week)} />
            <StatCard label="하루 방문" value={fmt(stats?.visitors.day)} />
            <div style={{ ...card, gap: 7 }}>
              <input type="date" value={vStart} max={vEnd} onChange={(e) => setVStart(e.target.value)} style={dateInput} />
              <input type="date" value={vEnd} min={vStart} max={_today} onChange={(e) => setVEnd(e.target.value)} style={dateInput} />
              <button onClick={fetchRange} disabled={rangeLoading || vStart > vEnd}
                style={{ ...actionBtn(rangeLoading || vStart > vEnd), padding: '8px 10px', fontSize: 12 }}>
                {rangeLoading ? '조회 중…' : '기간 방문자'}
              </button>
              {rangeCount !== null && (
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', fontWeight: 700, lineHeight: 1.4 }}>
                  {vStart} ~ {vEnd}<br />{rangeCount.toLocaleString('ko-KR')}명
                </span>
              )}
            </div>
          </div>
        </section>

        {/* 2) 처리 현황 | 바로가기 */}
        <div style={panelGrid}>
          <section style={card}>
            <h2 style={sectionTitle}>처리 현황</h2>
            <p style={panelDesc}>자막 → 파싱 → 라벨 → 스코어 → 벡터 단계별 처리 건수</p>
            {statsLoading ? (
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>로딩 중…</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {PROC_STAGES.map(({ key, label }) => {
                  const counts = stats?.processing?.[key] ?? {};
                  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
                  return (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ width: 76, flexShrink: 0, fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>{label}</span>
                      {entries.length === 0 ? (
                        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>—</span>
                      ) : entries.map(([state, n]) => (
                        <span key={state} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5, padding: '4px 9px', borderRadius: 7, background: STATE_BG[state] ?? 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>{STATE_LABELS[state] ?? state}</span>
                          <span style={{ fontSize: 14, fontWeight: 800 }}>{n.toLocaleString('ko-KR')}</span>
                        </span>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section style={card}>
            <h2 style={sectionTitle}>바로가기</h2>
            <p style={panelDesc}>모니터링·인프라 콘솔과 DB 바로가기</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <LinkRow label="영화 정보 리스트" desc="DB 영화 목록·편집" onClick={() => router.push('/movie_list')} />
              <LinkRow label="Grafana" desc="메트릭 대시보드" href="https://grafana.peakly.art" />
              <LinkRow label="ArgoCD" desc="배포 (GitOps)" href="https://argocd.peakly.art" />
              <LinkRow label="Argo Workflow" desc="워크플로 실행" href="https://workflow.peakly.art" />
              <LinkRow label="SVC DB" desc="서비스 DB (vm4)" href="https://data.peakly.art" />
              <LinkRow label="AI DB" desc="AI DB (vm5)" href="https://ai.peakly.art" />
            </div>
          </section>
        </div>

        {/* 3) 활성 모델 */}
        <section>
          <h2 style={sectionTitle}>활성 모델</h2>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ ...card, flex: '1 1 220px', justifyContent: 'center' }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>모델 버전</span>
              <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent)', letterSpacing: '-0.02em' }}>{activeModel?.version ?? '—'}</span>
            </div>
            <div style={{ flex: '2 1 360px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <StatCard label="MAE · arousal" value={fmtMetric(activeModel?.metrics?.mae_arousal)} accent />
              <StatCard label="MAE · valence" value={fmtMetric(activeModel?.metrics?.mae_valence)} />
              <StatCard label="Spearman · arousal" value={fmtMetric(activeModel?.metrics?.spearman_movie_arousal)} accent />
              <StatCard label="Spearman · valence" value={fmtMetric(activeModel?.metrics?.spearman_movie_valence)} />
            </div>
          </div>
        </section>

        {/* 4) 영화 메타 데이터 수집 */}
        <CollectCard
          title="영화 메타 데이터 수집"
          desc="tmdb 인기도 순으로 새로운 영화 메타 데이터를 수집합니다."
          n={backfillN} setN={setBackfillN} nMax={2000}
          running={!!backfill?.running} onRun={runBackfill}
          runLabel={backfill?.running ? '추가 중…' : '메타 데이터 수집'}
          job={backfill} onCloseJob={() => setBackfill(null)} jobLabel="영화 수집"
        />

        {/* 5) 자막 데이터 수집 */}
        <CollectCard
          title="자막 데이터 수집"
          desc="subdl에서 자막 데이터가 없는 영화의 자막을 수집합니다."
          n={collectN} setN={setCollectN} nMax={remaining ?? undefined}
          running={!!collect?.running} disabled={remaining === 0} onRun={runCollect}
          runLabel={collect?.running ? '수집 중…' : '자막 데이터 수집'}
          hint={remaining === null ? '최대 —' : `최대 ${remaining.toLocaleString('ko-KR')}개 수집 가능`}
          job={collect} onCloseJob={() => setCollect(null)} jobLabel="자막 수집"
        />
      </main>
    </div>
  );
}

function fmtMetric(n: number | undefined): string {
  return typeof n === 'number' ? n.toFixed(3) : '—';
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

function LinkRow({ label, desc, href, onClick }: { label: string; desc: string; href?: string; onClick?: () => void }) {
  const inner = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, width: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)' }}>{label}</span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{desc}</span>
      </div>
      <span style={{ color: 'var(--accent)', fontSize: 14 }}>{href ? '↗' : '→'}</span>
    </div>
  );
  const style: React.CSSProperties = {
    display: 'flex', alignItems: 'center', textAlign: 'left',
    padding: '12px 14px', borderRadius: 10,
    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
    cursor: 'pointer', textDecoration: 'none', fontFamily: 'inherit',
  };
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" style={style}>{inner}</a>
  ) : (
    <button onClick={onClick} style={{ ...style, width: '100%' }}>{inner}</button>
  );
}

function CollectCard(props: {
  title: string; desc: string;
  n: number; setN: (v: number) => void; nMax?: number;
  running: boolean; disabled?: boolean; onRun: () => void; runLabel: string; hint?: string;
  job: Job | null; onCloseJob: () => void; jobLabel: string;
}) {
  return (
    <section style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ ...sectionTitle, margin: '0 0 4px' }}>{props.title}</h2>
          <p style={{ margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{props.desc}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="number" min={1} max={props.nMax} value={props.n}
            onChange={(e) => props.setN(Math.max(1, Number(e.target.value) || 1))}
            disabled={props.running} style={numInput}
          />
          <button onClick={props.onRun} disabled={props.running || props.disabled}
            style={actionBtn(props.running || !!props.disabled)}>
            {props.runLabel}
          </button>
        </div>
      </div>
      {props.hint && <span style={hintText}>{props.hint}</span>}
      <div style={{ marginTop: 4 }}>
        {props.job ? (
          <JobBanner job={props.job} label={props.jobLabel} onClose={props.onCloseJob} />
        ) : (
          <div style={{ padding: '18px', borderRadius: 10, background: 'rgba(255,255,255,0.02)',
                        border: '1px dashed rgba(255,255,255,0.08)', textAlign: 'center',
                        fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>
            진행 중인 작업 없음 (로그)
          </div>
        )}
      </div>
    </section>
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

const card: React.CSSProperties = {
  background: 'rgba(255,255,255,0.02)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 12,
  padding: '20px 22px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const panelGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
  gap: 16,
};

const panelDesc: React.CSSProperties = {
  margin: '-4px 0 6px', fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5,
};

const dateInput: React.CSSProperties = {
  padding: '7px 9px', borderRadius: 8,
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
  color: 'var(--fg)', fontSize: 12, fontFamily: 'inherit', outline: 'none',
  colorScheme: 'dark',
};

const numInput: React.CSSProperties = {
  width: 80, padding: '13px 10px', borderRadius: 10,
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
  color: 'var(--fg)', fontSize: 14, fontFamily: 'inherit', outline: 'none',
};

const hintText: React.CSSProperties = {
  fontSize: 11, color: 'rgba(255,255,255,0.4)', paddingLeft: 2,
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
