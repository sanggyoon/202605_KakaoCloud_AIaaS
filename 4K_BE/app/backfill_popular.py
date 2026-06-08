"""TMDB 인기작 중 DB에 없는 영화를 채우는 backfill.
실행: python -m app.backfill_popular  (CronJob 진입점)
"""
import asyncio
import os

import httpx
from dotenv import load_dotenv

from app import tmdb_common as tc

MAX_NEW    = int(os.getenv("BACKFILL_MAX_NEW", "100"))
MAX_PAGES  = int(os.getenv("BACKFILL_MAX_PAGES", "100"))
RATE_DELAY = float(os.getenv("BACKFILL_RATE_DELAY", "0.26"))
BATCH_SIZE = 50


async def run_backfill(client: httpx.AsyncClient, max_new: int, max_pages: int,
                       rate_delay: float) -> dict:
    """인기순 페이지를 돌며 DB에 없는 영화를 upsert. 신규 max_new 도달 시 중지."""
    existing = await tc.get_existing_tmdb_ids(client)
    added, failed, batch, page = 0, [], [], 1

    while added < max_new and page <= max_pages:
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
                added += 1
                if len(batch) >= BATCH_SIZE:
                    await tc.upsert_movies(client, batch, resolution="ignore-duplicates")
                    batch.clear()
            else:
                failed.append(tid)
            if added >= max_new:
                break
            if rate_delay:
                await asyncio.sleep(rate_delay)
        page += 1

    if batch:
        await tc.upsert_movies(client, batch, resolution="ignore-duplicates")

    return {"added": added, "last_page": page, "failed": failed}


async def main() -> None:
    # 로컬 실행 편의: .env 로드 (쿠버네티스에서는 env가 직접 주입되어 무시됨).
    _base_dir = os.path.dirname(os.path.dirname(__file__))  # 4K_BE/
    load_dotenv(os.path.join(_base_dir, ".env"))
    load_dotenv(os.path.join(_base_dir, "DB_SCRIPTS", ".env"))

    async with httpx.AsyncClient(timeout=20, verify=False) as client:
        result = await run_backfill(client, MAX_NEW, MAX_PAGES, RATE_DELAY)
    print(f"[backfill] 신규 {result['added']}개, 마지막 page {result['last_page']}, "
          f"실패 {len(result['failed'])}개: {result['failed']}")


if __name__ == "__main__":
    asyncio.run(main())
