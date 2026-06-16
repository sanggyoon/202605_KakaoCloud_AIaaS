# 매니저 페이지 레이아웃 재구성 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `4K_FE/app/manager/page.tsx`의 `<main>` 레이아웃을 와이어프레임대로 재구성한다(로직 불변).

**Architecture:** 기존 state/handler/StatCard/JobBanner/PROC_STAGES/스타일을 그대로 재사용하고 `<main>` 본문만 교체. 반복되는 수집 카드는 `CollectCard`, 링크 항목은 `LinkRow` 헬퍼로 추출. 새 스타일 const 추가.

**Tech Stack:** Next.js client component, 인라인 스타일. next build로 검증.

**선행 스펙:** `docs/superpowers/specs/2026-06-16-manager-layout-redesign-design.md`

**경로:** `4K_FE/app/manager/page.tsx`. git 루트=`/Users/sanggyoon/Documents/KakaoCloud_Project`. 커밋 끝:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## 사전 메모 (불변 식별자 — 재사용)

state/handler: `stats, statsLoading, activeModel, vStart/setVStart, vEnd/setVEnd, _today, rangeCount, rangeLoading, fetchRange, backfill, collect, backfillN/setBackfillN, collectN/setCollectN, remaining, runBackfill, runCollect, router`.
컴포넌트/스타일: `StatCard, JobBanner, fmt, fmtMetric, PROC_STAGES, STATE_BG, STATE_LABELS, sectionTitle, cardGrid, numInput, hintText, actionBtn`.

> JobBanner는 이미 import됨. 이번 작업은 **렌더 구조만** 바꾼다.

---

## Task 1: `<main>` 레이아웃 교체 + 헬퍼/스타일

**Files:** Modify `4K_FE/app/components/...` 아님 — `4K_FE/app/manager/page.tsx` 만.

- [ ] **Step 1: 스타일 const 추가**

`const cardGrid` 정의 아래에 추가:
```tsx
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
```

- [ ] **Step 2: 헬퍼 컴포넌트 추가 (`LinkRow`, `CollectCard`)**

`function StatCard(...) { ... }` 아래에 추가:
```tsx
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
  job: import('@/app/components/JobBanner').Job | null;  // 실제 Job 타입 위치에 맞게(아래 주석 참고)
  onCloseJob: () => void; jobLabel: string;
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
```
> **Job 타입**: `CollectCard`의 `job` prop 타입은 페이지 상단에 이미 정의된 `Job` 인터페이스를 쓴다. import 형태(`import('@/app/components/JobBanner').Job`)가 실제와 다르면, 페이지 내 `Job` 타입을 그대로 참조하도록 `job: Job | null`로 바꾼다(같은 파일이면 타입명만 사용). 구현 시 빌드 에러로 확인.

- [ ] **Step 3: `<main> ... </main>` 전체 교체**

기존 `<main style={{ padding: '32px 64px 60px', ... }}>` 부터 그 `</main>`까지 전체를 다음으로 교체:
```tsx
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

        {/* 2) 처리 현황 | 바로가기 (2단) */}
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
```

- [ ] **Step 4: `CollectCard` job 타입 정정**

빌드 에러 시 `CollectCard`의 `job:` 타입을 페이지 상단에 정의된 `Job` 인터페이스로 맞춘다(같은 파일이므로 `job: Job | null`). `import('...')` 형태 제거.

- [ ] **Step 5: 빌드(타입체크)**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE && npm run build 2>&1 | grep -E "Compiled|Failed|Error|never used"`
Expected: `✓ Compiled successfully`. (미사용 식별자 경고 나오면 제거.)

- [ ] **Step 6: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/manager/page.tsx
git commit -m "feat(manager): 페이지 레이아웃 재구성(방문자+기간 / 처리현황·바로가기 2단 / 모델 / 수집카드별 로그)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: 마무리

- [ ] **Step 1: 최종 빌드**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE && npm run build 2>&1 | tail -3`
Expected: Compiled.

- [ ] **Step 2: 수동 확인 (배포 후)**

- 1행: 방문자 4카드 + 기간조회 박스(날짜 선택 시 `시작~종료 · N명` 표시).
- 2행: 처리현황 | 바로가기 2단(설명 포함, 링크 새 탭/내부 이동).
- 3행: 모델 버전 + 2×2 지표(arousal accent).
- 4·5행: 메타/자막 수집 카드 각각 설명+입력+버튼+로그(잡 없으면 플레이스홀더, 실행 시 진행 배너).

- [ ] **Step 3: finishing-a-development-branch**

**REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch

---

## Self-Review 메모

- **스펙 커버리지:** 방문자+기간(1행)·2단(처리/바로가기)·모델(버전+2×2)·수집카드별 로그 = Task1 Step3. 날짜 선택 표시 = 기간박스 결과. arousal 강조 = accent. 로직 불변(핸들러/엔드포인트 그대로 재사용).
- **타입 일관성:** 재사용 식별자명 일치. `CollectCard`/`LinkRow` 신규. `job` 타입은 페이지 `Job`(Step4에서 보정).
- **placeholder:** 코드 완전. Step4는 타입 위치 보정 절차(추측 아님, 빌드로 확정).
- **엣지:** 좁은 화면 panelGrid/metric 그리드 자동 줄바꿈. 잡 없을 때 로그 플레이스홀더.
