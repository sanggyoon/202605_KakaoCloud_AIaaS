"""vm4 movies 읽기(REST) + vm5 subtitles/processing_status 쓰기(psycopg)."""
import os
from collections.abc import Iterator

import httpx


def _vm4() -> tuple[str, str]:
    url = os.getenv("DATA_SUPABASE_URL", "https://data.peakly.art")
    key = os.getenv("DATA_SUPABASE_KEY", "")
    return url, key


def iter_movies(page_size: int = 1000) -> Iterator[int]:
    """vm4 service DB의 movies에서 tmdb_id를 페이지네이션으로 순회."""
    url, key = _vm4()
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    offset = 0
    with httpx.Client(timeout=30, verify=False) as client:
        while True:
            r = client.get(
                f"{url}/rest/v1/movies",
                params={"select": "tmdb_id", "limit": page_size,
                        "offset": offset, "order": "tmdb_id"},
                headers=headers,
            )
            r.raise_for_status()
            rows = r.json()
            for row in rows:
                yield row["tmdb_id"]
            if len(rows) < page_size:
                break
            offset += page_size


def get_state(conn, tmdb_id: int) -> str | None:
    row = conn.execute(
        "select subtitle_state from training.processing_status where tmdb_id=%s",
        (tmdb_id,),
    ).fetchone()
    return row[0] if row else None


def save_subtitle(conn, tmdb_id: int, chosen: dict, raw_text: str) -> None:
    conn.execute(
        """
        insert into training.subtitles
          (tmdb_id, language, provider, provider_file_id, release_name, is_sdh, raw_text)
        values (%s, 'en', 'subdl', %s, %s, %s, %s)
        on conflict (tmdb_id) do update set
          provider_file_id = excluded.provider_file_id,
          release_name     = excluded.release_name,
          is_sdh           = excluded.is_sdh,
          raw_text         = excluded.raw_text
        """,
        (tmdb_id, str(chosen.get("url") or ""), chosen.get("release_name"),
         bool(chosen.get("hi")), raw_text),
    )


def set_status(conn, tmdb_id: int, state: str, error: str | None = None) -> None:
    conn.execute(
        """
        insert into training.processing_status (tmdb_id, subtitle_state, error, updated_at)
        values (%s, %s, %s, now())
        on conflict (tmdb_id) do update set
          subtitle_state = excluded.subtitle_state,
          error          = excluded.error,
          retry_count    = training.processing_status.retry_count
                           + case when excluded.subtitle_state = 'failed' then 1 else 0 end,
          updated_at     = now()
        """,
        (tmdb_id, state, error),
    )
