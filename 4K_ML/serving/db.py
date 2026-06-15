"""vm5 REST — 스코어링 대상/씬 조회 + scene_scores/score_state 적재."""
import os
from datetime import datetime, timezone

import httpx


def _ai() -> tuple[str, str]:
    return os.getenv("AI_DATABASE_URL", ""), os.getenv("AI_DATABASE_KEY", "")


def _auth():
    user = os.getenv("AI_BASIC_USER")
    return (user, os.getenv("AI_BASIC_PASS", "")) if user else None


def _headers(write: bool = False) -> dict:
    _, key = _ai()
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    if write:
        h["Content-Type"] = "application/json"
        h["Prefer"] = "resolution=merge-duplicates,return=minimal"
    return h


def _get(client: httpx.Client, table: str, params: dict) -> list[dict]:
    url, _ = _ai()
    r = client.get(f"{url}/rest/v1/{table}", params=params,
                   headers=_headers(), auth=_auth(), timeout=60)
    r.raise_for_status()
    return r.json()


def _get_all(client: httpx.Client, table: str, params: dict) -> list[dict]:
    """페이지네이션 fetch (대형 테이블용)."""
    out: list[dict] = []
    offset = 0
    while True:
        rows = _get(client, table, {**params, "limit": "1000", "offset": str(offset)})
        out.extend(rows)
        if len(rows) < 1000:
            break
        offset += 1000
    return out


def fetch_active_version(client: httpx.Client) -> str:
    """vm5 model_versions.active=true 의 base 버전(::없는). 없으면 roberta-va-v1."""
    rows = _get(client, "model_versions", {"select": "model_version", "active": "eq.true"})
    for r in rows:
        mv = r.get("model_version", "")
        if mv and "::" not in mv:
            return mv
    return "roberta-va-v1"


def select_score_targets(parse_done: set, scene_to_movie: dict, scored_scene_ids: set) -> list:
    """파싱완료 & 현재 씬 중 활성버전 점수가 하나라도 빠진 영화. (순수)"""
    movie_scenes: dict = {}
    for sid, tmdb in scene_to_movie.items():
        movie_scenes.setdefault(tmdb, []).append(sid)
    targets = []
    for tmdb, sids in movie_scenes.items():
        if tmdb not in parse_done:
            continue
        if any(sid not in scored_scene_ids for sid in sids):
            targets.append(tmdb)
    return targets


def fetch_score_targets(client: httpx.Client) -> list[int]:
    """활성버전 점수가 빠진 파싱완료 영화 (데이터 결산, 스테일 자동 치유)."""
    mv = fetch_active_version(client)
    status = _get_all(client, "processing_status", {"select": "tmdb_id,parse_state"})
    parse_done = {r["tmdb_id"] for r in status if r.get("parse_state") == "done"}
    subs = _get_all(client, "subtitles", {"select": "id,tmdb_id"})
    sub_map = {r["id"]: r["tmdb_id"] for r in subs}
    scenes = _get_all(client, "scenes", {"select": "id,subtitles_id"})
    scene_to_movie = {
        r["id"]: sub_map.get(r["subtitles_id"])
        for r in scenes if sub_map.get(r["subtitles_id"]) is not None
    }
    scored = _get_all(client, "scene_scores",
                      {"select": "scenes_id", "model_version": f"eq.{mv}::arousal"})
    scored_ids = {r["scenes_id"] for r in scored}
    return select_score_targets(parse_done, scene_to_movie, scored_ids)


def fetch_movie_scenes_for_scoring(client: httpx.Client, tmdb_id: int) -> list[dict]:
    """추론 입력용 씬(라벨 없음): scenes_id, scene_index + predict_core 인스턴스 필드."""
    subs = _get(client, "subtitles", {"select": "id", "tmdb_id": f"eq.{tmdb_id}", "limit": "1"})
    if not subs:
        return []
    sid = subs[0]["id"]
    scenes = _get(client, "scenes",
                  {"select": "id,scene_index,text,progress_ratio,start_ms,end_ms,dialogue_count",
                   "subtitles_id": f"eq.{sid}", "order": "scene_index", "limit": "100000"})
    if not scenes:
        return []
    dials = _get(client, "dialogues",
                 {"select": "scenes_id,gap_before_ms", "subtitles_id": f"eq.{sid}", "limit": "1000000"})
    gaps: dict[int, list[float]] = {}
    for d in dials:
        g = d.get("gap_before_ms")
        if g is not None:
            gaps.setdefault(d["scenes_id"], []).append(float(g))
    out = []
    for s in scenes:
        glist = gaps.get(s["id"], [])
        out.append({
            "scenes_id": s["id"], "scene_index": s["scene_index"],
            "text": s.get("text"), "progress_ratio": s.get("progress_ratio"),
            "start_ms": s["start_ms"], "end_ms": s["end_ms"],
            "dialogue_count": s.get("dialogue_count") or 0,
            "avg_gap_before_ms": (sum(glist) / len(glist)) if glist else 0.0,
        })
    return out


def ensure_model_versions(client: httpx.Client, model_version: str) -> None:
    """scene_scores FK용 축별 행 보장 (예: roberta-va-v1::arousal/valence)."""
    url, _ = _ai()
    rows = [
        {"model_version": f"{model_version}::arousal", "kind": "roberta-score",
         "description": f"{model_version} arousal prediction"},
        {"model_version": f"{model_version}::valence", "kind": "roberta-score",
         "description": f"{model_version} valence prediction"},
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


def set_score_state(client: httpx.Client, tmdb_id: int, state: str, error: str | None = None) -> None:
    url, _ = _ai()
    row = {"tmdb_id": tmdb_id, "score_state": state, "error": error,
           "updated_at": datetime.now(timezone.utc).isoformat()}
    r = client.post(f"{url}/rest/v1/processing_status", params={"on_conflict": "tmdb_id"},
                    json=[row], headers=_headers(write=True), auth=_auth(), timeout=30)
    if r.status_code not in (200, 201, 204):
        raise RuntimeError(f"score_state upsert 실패 {r.status_code}: {r.text[:200]}")
