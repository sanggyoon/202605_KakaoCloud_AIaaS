"""TMDB 인기작 중 DB에 없는 영화를 채우는 backfill.
실행: python -m app.backfill_popular  (CronJob 진입점)

핵심 로직은 `backfill_events` 제너레이터에 있고, 진행 상황을 이벤트로 yield한다.
- CronJob/배치 실행은 `run_backfill`이 이를 소비해 최종 요약만 반환.
- 매니저 페이지의 수동 실행은 이 이벤트를 NDJSON으로 스트리밍해 진행 바를 그린다.
"""
import asyncio
import os
from typing import AsyncIterator

import httpx
from dotenv import load_dotenv

from app import tmdb_common as tc

BATCH_SIZE = 50


def config_from_env() -> tuple[int, int, float]:
    """CronJob과 수동 실행이 동일하게 쓰는 backfill 설정 (max_new, max_pages, rate_delay)."""
    return (
        int(os.getenv("BACKFILL_MAX_NEW", "100")),
        int(os.getenv("BACKFILL_MAX_PAGES", "100")),
        float(os.getenv("BACKFILL_RATE_DELAY", "0.26")),
    )


async def backfill_events(client: httpx.AsyncClient, max_new: int, max_pages: int,
                          rate_delay: float) -> AsyncIterator[dict]:
    """인기순 페이지를 돌며 DB에 없는 영화를 upsert하면서 진행 이벤트를 yield한다.

    이벤트:
      {"type": "progress", "processed": int, "target": int, "page": int, "title": str|None}
      {"type": "done", "added": int, "last_page": int, "failed": list[int]}
    `processed`는 fetch에 성공해 처리한 누적 수(진행 바 기준), `added`는 upsert 성공 수.
    """
    existing = await tc.get_existing_tmdb_ids(client)
    processed = 0         # fetch 성공 누적 (진행/중지 기준)
    added = 0             # upsert 성공 누적
    failed: list[int] = []
    batch: list[dict] = []

    async def flush() -> None:
        nonlocal added
        if not batch:
            return
        ok = await tc.upsert_movies(client, batch, resolution="ignore-duplicates")
        if ok:
            added += len(batch)
        else:
            failed.extend(m["tmdb_id"] for m in batch)
        batch.clear()

    page = 1
    while processed < max_new and page <= max_pages:
        results = await tc.tmdb_discover(client, sort_by="popularity.desc", page=page)
        if not results:
            break
        for m in results:
            tid = m["id"]
            if tid in existing:
                continue
            movie = await tc.fetch_movie(client, tid)
            if movie:
                batch.append(movie)
                existing.add(tid)
                processed += 1
                if len(batch) >= BATCH_SIZE:
                    await flush()
                yield {"type": "progress", "processed": processed, "target": max_new,
                       "page": page, "title": movie.get("title")}
            else:
                failed.append(tid)
            if processed >= max_new:
                break
            if rate_delay:
                await asyncio.sleep(rate_delay)
        page += 1

    await flush()
    yield {"type": "done", "added": added, "last_page": page, "failed": failed}


async def run_backfill(client: httpx.AsyncClient, max_new: int, max_pages: int,
                       rate_delay: float) -> dict:
    """backfill_events를 끝까지 소비해 최종 요약만 반환 (CronJob/배치 실행용).

    반환: {"added": upsert 성공 수, "last_page": 다음에 볼 page, "failed": 실패 tmdb_id 목록}
    """
    result = {"added": 0, "last_page": 1, "failed": []}
    async for ev in backfill_events(client, max_new, max_pages, rate_delay):
        if ev["type"] == "done":
            result = {"added": ev["added"], "last_page": ev["last_page"], "failed": ev["failed"]}
    return result


async def main() -> None:
    # 로컬 실행 편의: .env 로드 (쿠버네티스에서는 env가 직접 주입됨).
    _base_dir = os.path.dirname(os.path.dirname(__file__))  # 4K_BE/
    load_dotenv(os.path.join(_base_dir, ".env"))
    load_dotenv(os.path.join(_base_dir, "DB_SCRIPTS", ".env"))

    max_new, max_pages, rate_delay = config_from_env()
    async with httpx.AsyncClient(timeout=20, verify=False) as client:
        result = await run_backfill(client, max_new, max_pages, rate_delay)
    print(f"[backfill] 신규 {result['added']}개, 마지막 page {result['last_page']}, "
          f"실패 {len(result['failed'])}개: {result['failed']}")


if __name__ == "__main__":
    asyncio.run(main())
