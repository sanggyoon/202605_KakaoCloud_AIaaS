# DetailOverlay 상단 포스터 + 깜빡임 수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DetailOverlay 상단을 포스터(좌)+정보(우) 2단으로 만들고, backdrop-filter+스크롤 깜빡임을 제거한다.

**Architecture:** `4K_FE/app/components/DetailOverlay.tsx` 한 파일. 컨테이너 배경 불투명화(backdropFilter 제거) + 헤더 정보 블록을 포스터/정보 2단 flex로 래핑(클라이맥스 이하 섹션 불변).

**Tech Stack:** Next.js client component. next build로 검증.

**선행 스펙:** `docs/superpowers/specs/2026-06-16-detailoverlay-poster-flicker-design.md`

**경로:** `4K_FE/app/components/DetailOverlay.tsx`. git 루트=`/Users/sanggyoon/Documents/KakaoCloud_Project`. 커밋 끝:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## Task 1: 깜빡임 수정 + 포스터 2단

**Files:** Modify `4K_FE/app/components/DetailOverlay.tsx`

- [ ] **Step 1: 컨테이너 배경 불투명화(backdropFilter 제거)**

다음을
```tsx
        background: 'rgba(0,0,0,0.88)',
        backdropFilter: 'blur(14px)',
        zIndex: 90,
```
로 교체:
```tsx
        background: 'rgba(8,9,13,0.97)',
        zIndex: 90,
```

- [ ] **Step 2: 헤더 정보 블록을 포스터+정보 2단으로 래핑 (시작)**

다음을
```tsx
        {/* 단일 컬럼 레이아웃 (포스터 없음) */}
        <div>
          {/* 메타 · 제목 · 장르 */}
          <div
            style={{
              fontSize: 10,
```
로 교체:
```tsx
        <div>
          {/* 상단: 포스터(좌) + 정보(우) */}
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: 8 }}>
            {/* 포스터 */}
            <div style={{ width: 200, flexShrink: 0, aspectRatio: '2 / 3', borderRadius: 12, overflow: 'hidden', background: '#111218', position: 'relative' }}>
              {movie.poster_path ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`https://image.tmdb.org/t/p/w342${movie.poster_path}`}
                  alt={movie.title}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 32 }}>🎬</div>
              )}
            </div>
            {/* 정보 */}
            <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          {/* 메타 · 제목 · 장르 */}
          <div
            style={{
              fontSize: 10,
```

- [ ] **Step 3: 정보 컬럼 + 헤더 row 닫기 (장르 다음)**

다음을
```tsx
              >
                {g}
              </span>
            ))}
          </div>

          {/* 클라이맥스 곡선 */}
```
로 교체:
```tsx
              >
                {g}
              </span>
            ))}
          </div>
            </div>{/* /정보 */}
          </div>{/* /상단 2단 */}

          {/* 클라이맥스 곡선 */}
```

- [ ] **Step 4: 빌드(타입체크 + JSX 균형 확인)**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_FE && npm run build 2>&1 | grep -E "Compiled|Failed|Error"`
Expected: `✓ Compiled successfully`. (태그 불균형이면 에러 → Step2/3 들여쓰기·닫힘 재확인.)

- [ ] **Step 5: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/components/DetailOverlay.tsx
git commit -m "feat(detail): 상단 포스터+정보 2단 + 오버레이 깜빡임 수정(backdrop-filter 제거)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: 마무리

- [ ] **Step 1: 최종 빌드** — `cd 4K_FE && npm run build` → Compiled.
- [ ] **Step 2: 수동 확인(배포 후)**: 상단 포스터(좌)+정보(우), 좁은 화면 스택, 스크롤 시 깜빡임 없음, 그 아래 섹션 정상.
- [ ] **Step 3: finishing-a-development-branch** — REQUIRED SUB-SKILL.

---

## Self-Review 메모

- 스펙 커버리지: 포스터 2단=Step2/3, 깜빡임=Step1(backdropFilter 제거+불투명). 클라이맥스 이하 불변.
- 타입 일관성: 새 식별자 없음(movie.poster_path/title 사용). JSX 닫힘 균형은 Step3에서 `</div></div>` 2개로 맞춤(infoCol + headerRow).
- placeholder 없음. BE/로직 불변.
