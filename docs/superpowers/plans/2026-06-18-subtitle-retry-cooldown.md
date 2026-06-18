# 자막 수집 실패 재시도 쿨다운 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 자막 수집에서 `failed` 영화에 7일(env 조정) 쿨다운을 둬, 매일 같은 실패를 재시도해 신규 수집 예산(300/일)을 잠식하던 문제를 없앤다.

**Architecture:** `processing_status.updated_at`을 기준으로, `failed`이고 마지막 시도가 쿨다운 이내면 그 회차 대상에서 제외한다. `done`·`skipped`는 현행대로 영구 종료, `failed`의 기존 3회 상한도 유지(→ failed는 최대 3회·약 7일 간격 후 종료). 모든 변경은 `subtitle_collect.py` 한 파일.

**Tech Stack:** Python 3.11(FastAPI BE), httpx, PostgREST(vm5 processing_status).

## Global Constraints

- 대상 파일: `4K_BE/app/subtitle_collect.py` (한 파일).
- 동작(Option B): `done`/`skipped` 영구 종료(현행). `failed`만 쿨다운 + `MAX_RETRIES=3` 유지.
- 쿨다운 일수: env **`SUBTITLE_RETRY_COOLDOWN_DAYS`**(기본 7). 기본값이라 매니페스트 변경 불필요.
- `remaining_counts`도 쿨다운 반영(매니저 "남은" 수가 실제 시도 가능 수와 일치). 단 반환 dict 키
  이름(`total`/`terminal`/`remaining`)은 **소비자 호환 위해 유지**.
- `collect_one`(강제 단건 재수집)은 상태 게이트를 무시하는 용도라 **변경하지 않음**.
- 테스트 러너 없음 → 검증 = `python -m py_compile app/subtitle_collect.py` + 로직 검토.
  (모듈이 httpx/dotenv를 import해 로컬 venv 없이는 실행 임포트 불가 → 런타임 확인은 배포 후 cron 로그.)
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- 작업 브랜치: `feat/subtitle-retry-cooldown` (이미 생성됨).

## File Structure

- **Modify** `4K_BE/app/subtitle_collect.py` — import에 `timedelta` 추가, `fetch_status`에
  `updated_at` 추가, `_cooldown_days`/`_in_cooldown` 헬퍼 추가, `collect_events`·`remaining_counts`
  게이트에 쿨다운 반영.

---

### Task 1: failed 자막 7일 쿨다운 구현

**Files:**
- Modify: `4K_BE/app/subtitle_collect.py`

**Interfaces:**
- Consumes: 기존 `_is_terminal`, `fetch_status`, `ai_url/ai_headers`, `tc.get_existing_tmdb_ids`.
- Produces:
  - `_cooldown_days() -> int`
  - `_in_cooldown(info: dict, now: datetime, days: int) -> bool`
  - `fetch_status`가 `{tmdb_id: {"state", "retry", "updated"}}` 반환(키 `updated` 추가).

- [ ] **Step 1: datetime import에 timedelta 추가**

`4K_BE/app/subtitle_collect.py`의 `from datetime import datetime, timezone` 를 교체:

```python
from datetime import datetime, timedelta, timezone
```

- [ ] **Step 2: `fetch_status`에 `updated_at` 추가**

기존 `fetch_status` 전체를 교체:

```python
async def fetch_status(client: httpx.AsyncClient) -> dict[int, dict]:
    """processing_status를 {tmdb_id: {"state", "retry", "updated"}}로 한 번에 조회."""
    r = await client.get(
        f"{ai_url()}/rest/v1/processing_status",
        params={"select": "tmdb_id,subtitle_state,retry_count,updated_at", "limit": "1000000"},
        headers=ai_headers(), auth=_ai_auth(),
    )
    if r.status_code != 200:
        return {}
    return {
        row["tmdb_id"]: {
            "state": row.get("subtitle_state"),
            "retry": row.get("retry_count") or 0,
            "updated": row.get("updated_at"),
        }
        for row in r.json()
    }
```

- [ ] **Step 3: 쿨다운 헬퍼 추가**

`_is_terminal` 함수 **바로 아래**에 추가:

```python
def _cooldown_days() -> int:
    return int(os.getenv("SUBTITLE_RETRY_COOLDOWN_DAYS", "7"))


def _in_cooldown(info: dict, now: datetime, days: int) -> bool:
    """failed 영화가 마지막 시도 후 days일 이내면 True(이번 회차 건너뜀)."""
    if info.get("state") != "failed":
        return False
    ts = info.get("updated")
    if not ts:
        return False
    try:
        last = datetime.fromisoformat(ts)
    except ValueError:
        return False
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    return (now - last) < timedelta(days=days)
```

- [ ] **Step 4: `collect_events` 타겟 게이트에 쿨다운 반영**

`collect_events` 안에서 `status = await fetch_status(client)` 다음 줄에 추가:

```python
    now = datetime.now(timezone.utc)
    cooldown = _cooldown_days()
```

그리고 기존 타겟 게이트
```python
        info = status.get(tmdb_id)
        if info and _is_terminal(info):
            continue
```
를 다음으로 교체:
```python
        info = status.get(tmdb_id)
        if info and (_is_terminal(info) or _in_cooldown(info, now, cooldown)):
            continue
```

- [ ] **Step 5: `remaining_counts`에 쿨다운 반영**

기존 `remaining_counts` 전체를 교체:

```python
async def remaining_counts(client: httpx.AsyncClient) -> dict:
    """수집 가능한(=종료·쿨다운 아닌) 영화 수. {total, terminal, remaining}."""
    movie_ids = await tc.get_existing_tmdb_ids(client)
    status = await fetch_status(client)
    now = datetime.now(timezone.utc)
    cooldown = _cooldown_days()
    blocked = sum(
        1 for mid in movie_ids
        if mid in status and (_is_terminal(status[mid]) or _in_cooldown(status[mid], now, cooldown))
    )
    total = len(movie_ids)
    return {"total": total, "terminal": blocked, "remaining": total - blocked}
```

> `terminal` 키는 이제 "종료+쿨다운"을 포함하지만, 소비자(매니저 표시)는 `remaining`만
> 의미 있게 쓰므로 키 이름은 유지한다.

- [ ] **Step 6: 구문 검사**

Run: `cd 4K_BE && python -m py_compile app/subtitle_collect.py && echo "PY OK"`
Expected: `PY OK`

- [ ] **Step 7: 로직 검토 (체크리스트)**

아래가 코드로 성립하는지 눈으로 확인:
- done/skipped → `_is_terminal` True → 제외(영구). ✅
- failed & retry≥3 → `_is_terminal` True → 제외(영구). ✅
- failed & retry<3 & 최근(<7일) → `_in_cooldown` True → 제외(쿨다운). ✅
- failed & retry<3 & 7일↑ → 둘 다 False → **시도**. ✅
- pending/없음 → 둘 다 False → 시도(신규). ✅

- [ ] **Step 8: 커밋**

```bash
cd 4K_BE && git add app/subtitle_collect.py
git commit -m "$(printf 'feat(be): 자막 failed 7일 재시도 쿨다운(Option B)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## 완료 후

- `superpowers:finishing-a-development-branch`로 main 머지/PR 결정.
- 머지 후 CI가 4k-be 이미지 빌드 → ArgoCD 동기화 → 다음 자막 cron(UTC 19:00)부터 적용.
- 효과 확인: cron 로그에서 동일 failed 재시도가 줄고 added(신규) 비중이 느는지.
  쿨다운 일수를 바꾸려면 `subtitle-cronjob.yaml` env에 `SUBTITLE_RETRY_COOLDOWN_DAYS` 추가.
- push 거부 시 `git fetch origin && git rebase origin/main` 후 재push.
