"""vm5 REST 입출력 (sync httpx). public 스키마, apikey 인증, 선택 basic auth."""
import os
from datetime import datetime, timezone

import httpx

VERSION_TAG = "llm-va-v1"
AROUSAL_MV = f"{VERSION_TAG}::arousal"
VALENCE_MV = f"{VERSION_TAG}::valence"


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


def fetch_label_targets(client: httpx.Client) -> list[int]:
    """parse_state='done' & label_state!='done'인 tmdb_id 목록."""
    url, _ = _ai()
    r = client.get(f"{url}/rest/v1/processing_status",
                   params={"select": "tmdb_id,parse_state,label_state", "limit": "1000000"},
                   headers=_headers(), auth=_auth(), timeout=30)
    r.raise_for_status()
    return [row["tmdb_id"] for row in r.json()
            if row.get("parse_state") == "done" and row.get("label_state") != "done"]


def fetch_scenes(client: httpx.Client, tmdb_id: int) -> list[dict]:
    """영화의 씬을 scene_index 순으로: [{scenes_id, scene_index, text}]."""
    url, _ = _ai()
    r = client.get(f"{url}/rest/v1/subtitles",
                   params={"select": "id", "tmdb_id": f"eq.{tmdb_id}", "limit": "1"},
                   headers=_headers(), auth=_auth(), timeout=30)
    r.raise_for_status()
    rows = r.json()
    if not rows:
        return []
    sid = rows[0]["id"]
    r = client.get(f"{url}/rest/v1/scenes",
                   params={"select": "id,scene_index,text", "subtitles_id": f"eq.{sid}",
                           "order": "scene_index", "limit": "100000"},
                   headers=_headers(), auth=_auth(), timeout=30)
    r.raise_for_status()
    return [{"scenes_id": row["id"], "scene_index": row["scene_index"], "text": row["text"]}
            for row in r.json()]


def ensure_model_versions(client: httpx.Client) -> None:
    url, _ = _ai()
    rows = [
        {"model_version": AROUSAL_MV, "kind": "llm-label",
         "description": "Sonnet 4.6 arousal label, 0-1 absolute anchors"},
        {"model_version": VALENCE_MV, "kind": "llm-label",
         "description": "Sonnet 4.6 valence label, 0-1 absolute anchors"},
    ]
    r = client.post(f"{url}/rest/v1/model_versions", params={"on_conflict": "model_version"},
                    json=rows, headers=_headers(write=True), auth=_auth(), timeout=30)
    if r.status_code not in (200, 201, 204):
        raise RuntimeError(f"model_versions upsert 실패 {r.status_code}: {r.text[:200]}")


def upsert_scene_scores(client: httpx.Client, rows: list[dict]) -> None:
    url, _ = _ai()
    r = client.post(f"{url}/rest/v1/scene_scores", params={"on_conflict": "scenes_id,model_version"},
                    json=rows, headers=_headers(write=True), auth=_auth(), timeout=60)
    if r.status_code not in (200, 201, 204):
        raise RuntimeError(f"scene_scores upsert 실패 {r.status_code}: {r.text[:200]}")


def set_label_state(client: httpx.Client, tmdb_id: int, state: str, error: str | None = None) -> None:
    url, _ = _ai()
    row = {"tmdb_id": tmdb_id, "label_state": state, "error": error,
           "updated_at": datetime.now(timezone.utc).isoformat()}
    r = client.post(f"{url}/rest/v1/processing_status", params={"on_conflict": "tmdb_id"},
                    json=[row], headers=_headers(write=True), auth=_auth(), timeout=30)
    if r.status_code not in (200, 201, 204):
        raise RuntimeError(f"label_state upsert 실패 {r.status_code}: {r.text[:200]}")
