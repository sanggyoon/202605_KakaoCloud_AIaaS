"""subdl 자막 수집 — 매니저 버튼/스트리밍과 (추후)CronJob이 공유.

핵심 로직은 `collect_events` async 제너레이터에 있고 진행 이벤트를 yield한다.
vm4 movies에서 vm5 processing_status가 done 아닌 영화만 골라 자막을 수집한다.
"""
import io
import os
import zipfile


SUBDL_API = "https://api.subdl.com/api/v1/subtitles"
SUBDL_DL = "https://dl.subdl.com"


class SubdlRateLimit(Exception):
    """subdl 일일 한도 초과/429."""


def config_from_env() -> tuple[int, float]:
    """(max_new, rate_delay) — 버튼 1회 수집량과 요청 간 지연."""
    return (
        int(os.getenv("SUBTITLE_MAX_NEW", "100")),
        float(os.getenv("SUBTITLE_RATE_DELAY", "0.5")),
    )


# ── 선택 로직 (순수) ──────────────────────────────────────────────

def is_sdh(c: dict) -> bool:
    return bool(c.get("hi"))


def _is_full_season(c: dict) -> bool:
    return bool(c.get("full_season"))


def _is_english(c: dict) -> bool:
    lang = (c.get("language") or c.get("lang") or "").lower()
    return lang in ("", "en", "english")


def choose(candidates: list[dict]) -> dict | None:
    """영어·단편 필터 → SDH 우선 → subdl 반환순 1등. 없으면 None.
    (subdl 검색은 format 미제공·name이 .zip이라 srt 필터는 안 함 — srt는 추출 단계 보장.)"""
    eligible = [c for c in candidates if _is_english(c) and not _is_full_season(c)]
    if not eligible:
        return None
    sdh = [c for c in eligible if is_sdh(c)]
    return (sdh or eligible)[0]


def _largest_srt(zip_bytes: bytes) -> str:
    """zip에서 가장 큰 .srt 텍스트(utf-8, 실패 시 latin-1)."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        srts = [n for n in z.namelist() if n.lower().endswith(".srt")]
        if not srts:
            raise ValueError("zip에 .srt 파일이 없음")
        biggest = max(srts, key=lambda n: z.getinfo(n).file_size)
        raw = z.read(biggest)
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("latin-1")


import asyncio
from datetime import datetime, timezone

import httpx

from app import tmdb_common as tc


def _subdl_key() -> str:
    key = os.getenv("SUBDL_API_KEY", "")
    if not key:
        raise RuntimeError("SUBDL_API_KEY 환경변수가 필요합니다.")
    return key


# ── vm5(ai) REST 접근 ─────────────────────────────────────────────

def ai_url() -> str:
    return os.getenv("AI_DATABASE_URL", "")


def _ai_key() -> str:
    return os.getenv("AI_DATABASE_KEY", "")


def _ai_auth():
    user = os.getenv("AI_BASIC_USER")
    return (user, os.getenv("AI_BASIC_PASS", "")) if user else None


def ai_headers(write: bool = False) -> dict:
    key = _ai_key()
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    if write:
        h["Content-Type"] = "application/json"
        h["Prefer"] = "resolution=merge-duplicates,return=minimal"
    return h


# ── subdl (async) ─────────────────────────────────────────────────

async def search(client: httpx.AsyncClient, tmdb_id: int) -> list[dict]:
    r = await client.get(SUBDL_API, params={
        "api_key": _subdl_key(), "tmdb_id": tmdb_id, "type": "movie",
        "languages": "EN", "subs_per_page": 30, "hi": 1, "releases": 1,
    })
    if r.status_code == 429:
        raise SubdlRateLimit("subdl 429")
    r.raise_for_status()
    data = r.json()
    if isinstance(data, dict) and data.get("status") is False:
        msg = str(data.get("error", "")).lower()
        if "limit" in msg or "quota" in msg:
            raise SubdlRateLimit(msg)
        return []
    return data.get("subtitles", []) if isinstance(data, dict) else []


async def download_and_extract(client: httpx.AsyncClient, url_path: str) -> str:
    url = url_path if url_path.startswith("http") else f"{SUBDL_DL}{url_path}"
    r = await client.get(url)
    if r.status_code == 429:
        raise SubdlRateLimit("subdl download 429")
    r.raise_for_status()
    return _largest_srt(r.content)


# ── vm5 io ────────────────────────────────────────────────────────

MAX_RETRIES = 3  # failed가 이 횟수에 도달하면 종료 상태로 간주(더는 재시도 안 함)


async def fetch_status(client: httpx.AsyncClient) -> dict[int, dict]:
    """processing_status를 {tmdb_id: {"state": str, "retry": int}}로 한 번에 조회."""
    r = await client.get(
        f"{ai_url()}/rest/v1/processing_status",
        params={"select": "tmdb_id,subtitle_state,retry_count", "limit": "1000000"},
        headers=ai_headers(), auth=_ai_auth(),
    )
    if r.status_code != 200:
        return {}
    return {
        row["tmdb_id"]: {"state": row.get("subtitle_state"), "retry": row.get("retry_count") or 0}
        for row in r.json()
    }


def _is_terminal(info: dict) -> bool:
    """더 시도하지 않을 종료 상태: done·skipped, 또는 failed가 재시도 상한 도달."""
    st = info.get("state")
    if st in ("done", "skipped"):
        return True
    return st == "failed" and (info.get("retry") or 0) >= MAX_RETRIES


async def remaining_counts(client: httpx.AsyncClient) -> dict:
    """수집 가능한(=종료 상태 아닌) 영화 수. {total, terminal, remaining}."""
    movie_ids = await tc.get_existing_tmdb_ids(client)
    status = await fetch_status(client)
    terminal = sum(1 for mid in movie_ids if mid in status and _is_terminal(status[mid]))
    total = len(movie_ids)
    return {"total": total, "terminal": terminal, "remaining": total - terminal}


async def save_subtitle(client: httpx.AsyncClient, tmdb_id: int, chosen: dict, raw_text: str) -> None:
    row = {
        "tmdb_id": tmdb_id, "language": "en", "provider": "subdl",
        "provider_file_id": str(chosen.get("url") or ""),
        "release_name": chosen.get("release_name"),
        "is_sdh": bool(chosen.get("hi")), "raw_text": raw_text,
    }
    r = await client.post(f"{ai_url()}/rest/v1/subtitles",
                          params={"on_conflict": "tmdb_id"}, json=[row],
                          headers=ai_headers(write=True), auth=_ai_auth())
    if r.status_code not in (200, 201, 204):
        raise RuntimeError(f"subtitles upsert 실패 {r.status_code}: {r.text[:200]}")


async def set_status(client: httpx.AsyncClient, tmdb_id: int, state: str,
                     error: str | None = None, retry_count: int | None = None) -> None:
    row = {"tmdb_id": tmdb_id, "subtitle_state": state, "error": error,
           "updated_at": datetime.now(timezone.utc).isoformat()}
    if retry_count is not None:
        row["retry_count"] = retry_count
    r = await client.post(f"{ai_url()}/rest/v1/processing_status",
                          params={"on_conflict": "tmdb_id"}, json=[row],
                          headers=ai_headers(write=True), auth=_ai_auth())
    if r.status_code not in (200, 201, 204):
        raise RuntimeError(f"status upsert 실패 {r.status_code}: {r.text[:200]}")


# ── 이벤트 제너레이터 ─────────────────────────────────────────────

async def collect_events(client: httpx.AsyncClient, max_new: int, rate_delay: float):
    """vm4 movies 중 vm5에서 done 아닌 영화를 최대 max_new편 수집하며 진행 이벤트 yield.

    {"type":"progress","processed":int,"target":int,"title":str|None}
    {"type":"done","added":int,"skipped":int,"failed":list[int]}
    processed = 시도한(자막 없던) 영화 누적. SubdlRateLimit 시 done으로 마무리.
    """
    movie_ids = sorted(await tc.get_existing_tmdb_ids(client))
    status = await fetch_status(client)
    processed = 0
    added = 0
    skipped = 0
    failed: list[int] = []

    for tmdb_id in movie_ids:
        if processed >= max_new:
            break
        info = status.get(tmdb_id)
        if info and _is_terminal(info):
            continue
        prev_retry = (info or {}).get("retry", 0)
        title = None
        try:
            chosen = choose(await search(client, tmdb_id))
            if chosen is None:
                await set_status(client, tmdb_id, "skipped")
                skipped += 1
            else:
                title = chosen.get("release_name")
                raw = await download_and_extract(client, chosen.get("url") or "")
                if not raw.strip():
                    await set_status(client, tmdb_id, "failed", "empty srt", retry_count=prev_retry + 1)
                    failed.append(tmdb_id)
                else:
                    await save_subtitle(client, tmdb_id, chosen, raw)
                    await set_status(client, tmdb_id, "done")
                    added += 1
        except SubdlRateLimit:
            break
        except Exception as e:  # noqa: BLE001
            await set_status(client, tmdb_id, "failed", str(e)[:500], retry_count=prev_retry + 1)
            failed.append(tmdb_id)
        processed += 1
        yield {"type": "progress", "processed": processed, "target": max_new, "title": title}
        if rate_delay:
            await asyncio.sleep(rate_delay)

    yield {"type": "done", "added": added, "skipped": skipped, "failed": failed}
