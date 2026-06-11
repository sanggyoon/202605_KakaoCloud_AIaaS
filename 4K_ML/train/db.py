"""vm5 REST — 학습 데이터 조회(영화별) + model_versions 기록."""
import os

import httpx

LABEL_AROUSAL = "llm-va-v1::arousal"
LABEL_VALENCE = "llm-va-v1::valence"


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


def fetch_labeled_movies(client: httpx.Client) -> list[int]:
    """label_state='done'인 tmdb_id 목록."""
    rows = _get(client, "processing_status",
                {"select": "tmdb_id,label_state", "limit": "1000000"})
    return [row["tmdb_id"] for row in rows if row.get("label_state") == "done"]


def fetch_movie_scenes(client: httpx.Client, tmdb_id: int) -> list[dict]:
    """영화 1편의 학습 레코드. 두 축 라벨이 모두 있는 씬만 반환.

    반환 dict: movie_id, scenes_id, scene_index, text, progress_ratio,
               start_ms, end_ms, dialogue_count, avg_gap_before_ms, arousal, valence
    """
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
                 {"select": "scenes_id,gap_before_ms", "subtitles_id": f"eq.{sid}",
                  "limit": "1000000"})
    ids = ",".join(str(s["id"]) for s in scenes)
    scores = _get(client, "scene_scores",
                  {"select": "scenes_id,score,model_version", "scenes_id": f"in.({ids})",
                   "model_version": f'in.("{LABEL_AROUSAL}","{LABEL_VALENCE}")', "limit": "1000000"})

    # 씬별 gap 평균(None 제외)
    gaps: dict[int, list[float]] = {}
    for d in dials:
        g = d.get("gap_before_ms")
        if g is not None:
            gaps.setdefault(d["scenes_id"], []).append(float(g))
    # 씬별 라벨
    label: dict[tuple[int, str], float] = {}
    for s in scores:
        label[(s["scenes_id"], s["model_version"])] = s["score"]

    out = []
    for s in scenes:
        a = label.get((s["id"], LABEL_AROUSAL))
        v = label.get((s["id"], LABEL_VALENCE))
        if a is None or v is None:
            continue
        glist = gaps.get(s["id"], [])
        out.append({
            "movie_id": tmdb_id, "scenes_id": s["id"], "scene_index": s["scene_index"],
            "text": s.get("text"), "progress_ratio": s.get("progress_ratio"),
            "start_ms": s["start_ms"], "end_ms": s["end_ms"],
            "dialogue_count": s.get("dialogue_count") or 0,
            "avg_gap_before_ms": (sum(glist) / len(glist)) if glist else 0.0,
            "arousal": a, "valence": v,
        })
    return out


def upsert_model_version(client: httpx.Client, model_version: str, kind: str, metrics: dict) -> None:
    url, _ = _ai()
    row = {"model_version": model_version, "kind": kind, "metrics": metrics}
    r = client.post(f"{url}/rest/v1/model_versions", params={"on_conflict": "model_version"},
                    json=[row], headers=_headers(write=True), auth=_auth(), timeout=30)
    if r.status_code not in (200, 201, 204):
        raise RuntimeError(f"model_versions upsert 실패 {r.status_code}: {r.text[:200]}")
