"""vm4 movies 읽기 + vm5 subtitles/processing_status 쓰기 — 모두 Supabase REST(PostgREST).

vm5는 비공개 `training` 스키마라 PostgREST 프로파일 헤더(Accept-Profile/Content-Profile)를 쓴다.
nginx basic auth가 걸려 있으면 *_BASIC_USER/PASS env로 전달된다(없으면 미적용).
"""
import os
from collections.abc import Iterator
from datetime import datetime, timezone

import httpx


# ── vm4 (service DB) — movies 읽기 ──────────────────────────────────

def _vm4() -> tuple[str, str]:
    return (
        os.getenv("DATA_SUPABASE_URL", "https://data.peakly.art"),
        os.getenv("DATA_SUPABASE_KEY", ""),
    )


def _vm4_auth():
    user = os.getenv("DATA_BASIC_USER")
    return (user, os.getenv("DATA_BASIC_PASS", "")) if user else None


def iter_movies(page_size: int = 1000) -> Iterator[int]:
    """vm4 service DB의 movies에서 tmdb_id를 페이지네이션으로 순회."""
    url, key = _vm4()
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    offset = 0
    with httpx.Client(timeout=30, verify=False, auth=_vm4_auth()) as client:
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


# ── vm5 (AI DB, training 스키마) — subtitles/status 쓰기 ─────────────

def _vm5() -> tuple[str, str]:
    return os.getenv("AI_DATABASE_URL", ""), os.getenv("AI_DATABASE_KEY", "")


def _vm5_auth():
    user = os.getenv("AI_BASIC_USER")
    return (user, os.getenv("AI_BASIC_PASS", "")) if user else None


def _vm5_headers(write: bool = False) -> dict:
    _, key = _vm5()
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    if write:
        h["Content-Profile"] = "training"   # 비공개 스키마 쓰기 대상
        h["Content-Type"] = "application/json"
        h["Prefer"] = "resolution=merge-duplicates,return=minimal"
    else:
        h["Accept-Profile"] = "training"    # 비공개 스키마 읽기 대상
    return h


def get_state(tmdb_id: int) -> str | None:
    url, _ = _vm5()
    r = httpx.get(
        f"{url}/rest/v1/processing_status",
        params={"select": "subtitle_state", "tmdb_id": f"eq.{tmdb_id}", "limit": 1},
        headers=_vm5_headers(), timeout=30, verify=False, auth=_vm5_auth(),
    )
    r.raise_for_status()
    rows = r.json()
    return rows[0]["subtitle_state"] if rows else None


def save_subtitle(tmdb_id: int, chosen: dict, raw_text: str) -> None:
    url, _ = _vm5()
    row = {
        "tmdb_id": tmdb_id,
        "language": "en",
        "provider": "subdl",
        "provider_file_id": str(chosen.get("url") or ""),
        "release_name": chosen.get("release_name"),
        "is_sdh": bool(chosen.get("hi")),
        "raw_text": raw_text,
    }
    r = httpx.post(
        f"{url}/rest/v1/subtitles",
        params={"on_conflict": "tmdb_id"},
        json=[row],
        headers=_vm5_headers(write=True), timeout=60, verify=False, auth=_vm5_auth(),
    )
    if r.status_code not in (200, 201, 204):
        raise RuntimeError(f"subtitles upsert 실패 {r.status_code}: {r.text[:200]}")


def set_status(tmdb_id: int, state: str, error: str | None = None) -> None:
    url, _ = _vm5()
    row = {
        "tmdb_id": tmdb_id,
        "subtitle_state": state,
        "error": error,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    r = httpx.post(
        f"{url}/rest/v1/processing_status",
        params={"on_conflict": "tmdb_id"},
        json=[row],
        headers=_vm5_headers(write=True), timeout=30, verify=False, auth=_vm5_auth(),
    )
    if r.status_code not in (200, 201, 204):
        raise RuntimeError(f"status upsert 실패 {r.status_code}: {r.text[:200]}")
