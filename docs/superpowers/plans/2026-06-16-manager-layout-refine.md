# 매니저 레이아웃 리파인 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매니저 페이지의 기간 방문자 결과를 큰 숫자 카드로, 처리현황에 전체 영화 수+높이 채움, 바로가기에 Understand Everything 추가 및 Argo URL 수정, 카드 대비 향상.

**Architecture:** `4K_FE/app/manager/page.tsx` 한 파일의 인라인 스타일·렌더 조정. 로직/엔드포인트 불변. 전체 영화 수는 `stats.processing.subtitle_state` 합으로 FE 계산.

**Tech Stack:** Next.js client component. next build로 검증.

**선행 스펙:** `docs/superpowers/specs/2026-06-16-manager-layout-refine-design.md`

**경로:** `4K_FE/app/manager/page.tsx`. git 루트=`/Users/sanggyoon/Documents/KakaoCloud_Project`. 커밋 끝:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## Task 1: 매니저 리파인

**Files:** Modify `4K_FE/app/components/...` 아님 — `4K_FE/app/manager/page.tsx` 만.

- [ ] **Step 1: 카드 대비 향상 (공용 스타일)**

`const card`의 배경/테두리 밝게:
```tsx
const card: React.CSSProperties = {
  background: 'rgba(255,255,255,0.045)',
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: 12,
  padding: '20px 22px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};
```
`StatCard`의 div 스타일도 동일 밝기로:
```tsx
    <div style={{
      background: 'rgba(255,255,255,0.045)',
      border: '1px solid rgba(255,255,255,0.10)',
      borderRadius: 12, padding: '20px 22px',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
```
`LinkRow`의 `style` 배경/테두리:
```tsx
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
```

- [ ] **Step 2: 기간 방문자 — 컨트롤 카드 + 큰 숫자 결과 카드 분리**

방문자 행의 기존 기간 박스
```tsx
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
```
를 다음으로 교체(컨트롤 + 결과 2칸):
```tsx
            <div style={{ ...card, gap: 7 }}>
              <input type="date" value={vStart} max={vEnd} onChange={(e) => setVStart(e.target.value)} style={dateInput} />
              <input type="date" value={vEnd} min={vStart} max={_today} onChange={(e) => setVEnd(e.target.value)} style={dateInput} />
              <button onClick={fetchRange} disabled={rangeLoading || vStart > vEnd}
                style={{ ...actionBtn(rangeLoading || vStart > vEnd), padding: '8px 10px', fontSize: 12 }}>
                {rangeLoading ? '조회 중…' : '기간 방문자'}
              </button>
            </div>
            <div style={{ ...card, justifyContent: 'center' }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>기간 방문자</span>
              <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--accent)' }}>
                {rangeCount !== null ? rangeCount.toLocaleString('ko-KR') : '—'}
              </span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                {rangeCount !== null ? `${vStart} ~ ${vEnd}` : '날짜 선택 후 조회'}
              </span>
            </div>
```

- [ ] **Step 3: 처리 현황 — 전체 영화 수 + 높이 꽉 채움**

처리현황 `<section style={card}>` 내부를 다음 구조로 교체(설명 아래 전체수, 리스트 flex:1):
```tsx
          <section style={card}>
            <h2 style={sectionTitle}>처리 현황</h2>
            <p style={panelDesc}>
              자막 → 파싱 → 라벨 → 스코어 → 벡터 단계별 처리 건수
              {' · '}전체 영화 {Object.values(stats?.processing?.subtitle_state ?? {}).reduce((a, b) => a + b, 0).toLocaleString('ko-KR')}개
            </p>
            {statsLoading ? (
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>로딩 중…</div>
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 10 }}>
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
```
(기존 처리현황 `<section style={card}>...</section>` 블록 전체를 위로 교체.)

- [ ] **Step 4: 바로가기 — UE 추가 + Argo URL 수정**

바로가기 LinkRow 목록에서 Argo Workflow href 수정 + UE 추가:
```tsx
              <LinkRow label="영화 정보 리스트" desc="DB 영화 목록·편집" onClick={() => router.push('/movie_list')} />
              <LinkRow label="Understand Everything" desc="코드베이스 지식 그래프" href="https://understand.peakly.art" />
              <LinkRow label="Grafana" desc="메트릭 대시보드" href="https://grafana.peakly.art" />
              <LinkRow label="ArgoCD" desc="배포 (GitOps)" href="https://argocd.peakly.art" />
              <LinkRow label="Argo Workflow" desc="워크플로 실행" href="https://workflows.peakly.art" />
              <LinkRow label="SVC DB" desc="서비스 DB (vm4)" href="https://data.peakly.art" />
              <LinkRow label="AI DB" desc="AI DB (vm5)" href="https://ai.peakly.art" />
```
(기존 6개 LinkRow 블록을 위 7개로 교체. Argo Workflow는 `workflows`로.)

- [ ] **Step 5: 빌드(타입체크)**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE && npm run build 2>&1 | grep -E "Compiled|Failed|Error"`
Expected: `✓ Compiled successfully`

- [ ] **Step 6: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/manager/page.tsx
git commit -m "feat(manager): 기간 방문자 큰숫자·처리현황 전체수+높이채움·UE 링크·Argo URL·카드 대비

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: 마무리

- [ ] **Step 1: 최종 빌드** — `cd 4K_FE && npm run build` → Compiled.
- [ ] **Step 2: 수동 확인(배포 후)**: 카드 대비↑ / 기간 방문자 큰 숫자 / 처리현황 전체 영화 수 + 하단 빈공간 없음 / 바로가기 7개(UE 포함, Argo=workflows).
- [ ] **Step 3: finishing-a-development-branch** — REQUIRED SUB-SKILL.

---

## Self-Review 메모

- 스펙 커버리지: 큰숫자=Step2, 전체수+채움=Step3, UE+Argo URL=Step4, 대비=Step1. 전부 한 파일.
- 타입 일관성: 기존 `card/StatCard/LinkRow/dateInput/actionBtn/PROC_STAGES/STATE_BG/STATE_LABELS/panelDesc` 재사용. 새 식별자 없음.
- placeholder 없음. BE/로직 불변.
