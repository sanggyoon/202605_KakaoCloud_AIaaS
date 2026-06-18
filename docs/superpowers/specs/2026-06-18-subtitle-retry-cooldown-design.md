# 자막 수집 실패 재시도 쿨다운 설계

작성일: 2026-06-18
상태: 설계 승인됨 (Option B)

## 목적

자막 수집(`subtitle_collect`)이 매일 실패(`failed`) 영화를 다시 시도하면서, id 순서상
앞쪽 실패들이 **매일 300편 예산을 먼저 소모해 뒤쪽 신규 영화에 도달하지 못하는** 문제를
해결한다. 실패 영화에 **시간 기반 쿨다운(기본 7일)** 을 둬서, 매일이 아니라 일주일에 한 번만
재시도하게 하고 그동안의 예산은 신규 수집에 쓰도록 한다.

## 배경 / 확정 사실

- `4K_BE/app/subtitle_collect.py`:
  - `collect_events(max_new, rate_delay)`: vm4 movies를 **id 오름차순**으로 돌며
    종료(terminal) 아닌 영화를 최대 `max_new`(cron env `SUBTITLE_MAX_NEW`=300)편 시도.
    `processed`는 added/skipped/failed 모두 +1, `processed >= max_new`면 종료.
  - `fetch_status()` → `{tmdb_id: {"state": subtitle_state, "retry": retry_count}}`
    (현재 select: `tmdb_id,subtitle_state,retry_count`).
  - `_is_terminal(info)`: `done`·`skipped`, 또는 `failed` & `retry >= MAX_RETRIES(3)`.
  - `remaining_counts()`: `_is_terminal`로 수집 가능 수 계산(매니저 표시용).
  - 타겟 게이트: `if info and _is_terminal(info): continue`.
- `processing_status`에는 `updated_at timestamptz`가 있고, `set_status`가 매 시도마다
  갱신한다(쿨다운 기준으로 사용 가능).
- 현재 분포(2441편): done 1365 / skipped 864 / failed 212. `skipped`는 SUBDL에 영어
  자막이 없는 영화(영구 종료가 타당), `failed`는 다운로드 실패·빈 srt 등 일시 오류 多.

## 결정 사항 (Option B)

1. `done`·`skipped`는 **영구 종료(현행 유지)**. skipped는 "자막 자체가 없음"이라 재확인 안 함.
2. **`failed`에만 쿨다운**: 마지막 시도(`updated_at`)가 `COOLDOWN_DAYS`(기본 7) 이내면 이번
   회차 대상에서 제외. 7일 지나면 다시 1회 시도.
3. 기존 **재시도 상한(`MAX_RETRIES=3`)도 유지**: failed가 3회 도달하면 영구 종료.
   → 결과적으로 failed는 **최대 3회, 약 7일 간격**으로 시도 후 종료.
4. 쿨다운 일수는 env **`SUBTITLE_RETRY_COOLDOWN_DAYS`**(기본 7)로 조정 가능.

## 상세 설계

### 변경 1: `fetch_status`에 `updated_at` 추가
- select에 `updated_at` 추가, 반환 dict에 `"updated"` 키 추가:
  `{tmdb_id: {"state", "retry", "updated"}}` (`updated`는 ISO 문자열 또는 None).

### 변경 2: 쿨다운 판정 헬퍼
- `_cooldown_days() -> int`: `int(os.getenv("SUBTITLE_RETRY_COOLDOWN_DAYS", "7"))`.
- `_in_cooldown(info: dict, now: datetime, days: int) -> bool`:
  - `info["state"] == "failed"` 이고 `info["updated"]`가 파싱돼 `now - updated < days`이면 True.
  - `updated`가 없거나 파싱 실패면 False(=쿨다운 아님, 시도 허용).
  - `done`/`skipped`/`None`은 항상 False(쿨다운 무관 — terminal 여부는 `_is_terminal`가 담당).

### 변경 3: 타겟 게이트 + remaining 반영
- `collect_events` 루프: `now = datetime.now(timezone.utc)` 한 번 구하고,
  `if info and (_is_terminal(info) or _in_cooldown(info, now, days)): continue`.
- `remaining_counts`: 수집 가능 수에서 쿨다운 중 failed도 제외하도록
  `terminal_or_cooldown` 기준으로 계산(매니저 "남은" 수가 실제 시도 가능 수와 일치).

### 동작 요약 (영화별)
| 상태 | retry | 마지막 시도 | 이번 회차 |
|---|---|---|---|
| done / skipped | - | - | 제외(영구) |
| failed | ≥3 | - | 제외(영구) |
| failed | <3 | ≥7일 전 | **시도**(재시도) |
| failed | <3 | <7일 | 제외(쿨다운) |
| pending/없음 | - | - | 시도(신규) |

## 검증

- 테스트 러너 없음 → `python -m py_compile app/subtitle_collect.py`.
- 로직 검토: 위 표대로 게이트되는지. (가능 시) 매니저 `subtitles/remaining`이 쿨다운 반영해
  "남은" 수가 줄어드는지.
- 배포 후 다음 자막 cron 실행 로그에서 신규(added) 비중이 늘고 동일 failed 재시도가 줄었는지.

## 범위 밖 (YAGNI)

- skipped 주기적 재확인(Option A) — "자막 없음"은 거의 안 바뀌어 예산 낭비.
- backfill(영화 메타) 쪽 변경 — 별개.
- 실패 사유별 차등 쿨다운 — 단일 쿨다운으로 충분.
