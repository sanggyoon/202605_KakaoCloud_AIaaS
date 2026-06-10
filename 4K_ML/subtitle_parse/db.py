"""vm5 REST 입출력 (sync httpx). public 스키마, apikey 인증, 선택 basic auth."""
import os
from datetime import datetime, timezone

import httpx


def _ai() -> tuple[str, str]:
    return os.getenv("AI_DATABASE_URL", ""), os.getenv("AI_DATABASE_KEY", "")


def _auth():
    user = os.getenv("AI_BASIC_USER")
    return (user, os.getenv("AI_BASIC_PASS", "")) if user else None


def _headers(write: bool = False, representation: bool = False) -> dict:
    _, key = _ai()
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    if write:
        h["Content-Type"] = "application/json"
        ret = "return=representation" if representation else "return=minimal"
        h["Prefer"] = f"resolution=merge-duplicates,{ret}"
    return h


def fetch_targets(client: httpx.Client) -> list[int]:
    """subtitle_state='done' & parse_state!='done'인 tmdb_id 목록."""
    url, _ = _ai()
    r = client.get(f"{url}/rest/v1/processing_status",
                   params={"select": "tmdb_id,subtitle_state,parse_state", "limit": "1000000"},
                   headers=_headers(), auth=_auth(), timeout=30)
    r.raise_for_status()
    return [row["tmdb_id"] for row in r.json()
            if row.get("subtitle_state") == "done" and row.get("parse_state") != "done"]


def fetch_subtitle(client: httpx.Client, tmdb_id: int) -> dict | None:
    url, _ = _ai()
    r = client.get(f"{url}/rest/v1/subtitles",
                   params={"select": "id,tmdb_id,raw_text", "tmdb_id": f"eq.{tmdb_id}", "limit": "1"},
                   headers=_headers(), auth=_auth(), timeout=30)
    r.raise_for_status()
    rows = r.json()
    return rows[0] if rows else None


def upsert_scenes(client: httpx.Client, rows: list[dict]) -> list[dict]:
    url, _ = _ai()
    r = client.post(f"{url}/rest/v1/scenes", params={"on_conflict": "subtitles_id,scene_index"},
                    json=rows, headers=_headers(write=True, representation=True),
                    auth=_auth(), timeout=60)
    if r.status_code not in (200, 201):
        raise RuntimeError(f"scenes upsert 실패 {r.status_code}: {r.text[:200]}")
    return r.json()


def upsert_dialogues(client: httpx.Client, rows: list[dict]) -> None:
    url, _ = _ai()
    r = client.post(f"{url}/rest/v1/dialogues", params={"on_conflict": "subtitles_id,line_index"},
                    json=rows, headers=_headers(write=True), auth=_auth(), timeout=60)
    if r.status_code not in (200, 201, 204):
        raise RuntimeError(f"dialogues upsert 실패 {r.status_code}: {r.text[:200]}")


def set_parse_state(client: httpx.Client, tmdb_id: int, state: str, error: str | None = None) -> None:
    url, _ = _ai()
    row = {"tmdb_id": tmdb_id, "parse_state": state, "error": error,
           "updated_at": datetime.now(timezone.utc).isoformat()}
    r = client.post(f"{url}/rest/v1/processing_status", params={"on_conflict": "tmdb_id"},
                    json=[row], headers=_headers(write=True), auth=_auth(), timeout=30)
    if r.status_code not in (200, 201, 204):
        raise RuntimeError(f"parse_state upsert 실패 {r.status_code}: {r.text[:200]}")
