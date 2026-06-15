"""vm5(ai) 읽기 + vm4(data) 쓰기 — G 임베딩 전용.

env: AI_DATABASE_URL, AI_DATABASE_KEY (선택 AI_BASIC_USER/PASS)  ← vm5 읽기
     DATA_SUPABASE_URL, DATA_SUPABASE_KEY (선택 DATA_BASIC_USER/PASS) ← vm4 쓰기
"""
import os
from collections import defaultdict

import httpx

PAGE_SIZE = 1000
BATCH_SIZE = 50


# ── vm5 (ai) 읽기 ─────────────────────────────────────────────
def _ai() -> tuple[str, str]:
    return os.getenv("AI_DATABASE_URL", ""), os.getenv("AI_DATABASE_KEY", "")


def _ai_auth():
    u = os.getenv("AI_BASIC_USER")
    return (u, os.getenv("AI_BASIC_PASS", "")) if u else None


def _ai_headers() -> dict:
    _, k = _ai()
    return {"apikey": k, "Authorization": f"Bearer {k}"}


def _ai_get_all(client: httpx.Client, table: str, params: dict) -> list[dict]:
    url, _ = _ai()
    out: list[dict] = []
    offset = 0
    while True:
        r = client.get(f"{url}/rest/v1/{table}",
                       params={**params, "limit": PAGE_SIZE, "offset": offset},
                       headers=_ai_headers(), auth=_ai_auth(), timeout=60)
        r.raise_for_status()
        batch = r.json()
        out.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return out


def fetch_scene_index(client: httpx.Client) -> dict[int, tuple]:
    """scene_id → (progress_ratio, tmdb_id). scenes·subtitles 조인."""
    subs = _ai_get_all(client, "subtitles", {"select": "id,tmdb_id"})
    sub_map = {r["id"]: r["tmdb_id"] for r in subs}
    scenes = _ai_get_all(client, "scenes", {"select": "id,subtitles_id,progress_ratio"})
    return {r["id"]: (r.get("progress_ratio"), sub_map.get(r["subtitles_id"]))
            for r in scenes}


def fetch_axis_scores(client: httpx.Client, model_version_axis: str) -> list[dict]:
    """특정 축의 scene_scores 전체 (scenes_id, score)."""
    return _ai_get_all(client, "scene_scores",
                       {"select": "scenes_id,score", "model_version": f"eq.{model_version_axis}"})


def build_series(scores: list[dict], scene_index: dict[int, tuple]) -> dict[int, list]:
    """scene_scores + scene_index → {tmdb_id: [(progress, score)...]} (순수)."""
    series: dict[int, list] = defaultdict(list)
    for row in scores:
        info = scene_index.get(row["scenes_id"])
        if not info:
            continue
        progress, tmdb_id = info
        if tmdb_id is None or progress is None:
            continue
        series[tmdb_id].append((float(progress), float(row["score"])))
    return dict(series)


# ── vm4 (data) 쓰기 ───────────────────────────────────────────
def _data() -> tuple[str, str]:
    return os.getenv("DATA_SUPABASE_URL", ""), os.getenv("DATA_SUPABASE_KEY", "")


def _data_auth():
    u = os.getenv("DATA_BASIC_USER")
    return (u, os.getenv("DATA_BASIC_PASS", "")) if u else None


def _data_headers(write: bool = True) -> dict:
    _, k = _data()
    h = {"apikey": k, "Authorization": f"Bearer {k}"}
    if write:
        h["Content-Type"] = "application/json"
        h["Prefer"] = "resolution=merge-duplicates,return=minimal"
    return h


def upsert_vectors(client: httpx.Client, rows: list[dict]) -> None:
    """vm4 movie_vectors 배치 upsert (on_conflict=tmdb_id,vector_version)."""
    url, _ = _data()
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        r = client.post(f"{url}/rest/v1/movie_vectors",
                        params={"on_conflict": "tmdb_id,vector_version"},
                        json=batch, headers=_data_headers(), auth=_data_auth(),
                        timeout=60)
        if r.status_code not in (200, 201, 204):
            raise RuntimeError(f"vm4 upsert 실패 {r.status_code}: {r.text[:300]}")


def set_has_vector(client: httpx.Client, tmdb_ids: list[int]) -> None:
    """vm4 movies.has_vector=true 배치 (트리거 없을 때 대비; 멱등)."""
    url, _ = _data()
    for i in range(0, len(tmdb_ids), BATCH_SIZE):
        chunk = tmdb_ids[i:i + BATCH_SIZE]
        ids = ",".join(str(t) for t in chunk)
        r = client.patch(f"{url}/rest/v1/movies",
                         params={"tmdb_id": f"in.({ids})"},
                         json={"has_vector": True},
                         headers=_data_headers(), auth=_data_auth(), timeout=60)
        if r.status_code not in (200, 204):
            raise RuntimeError(f"vm4 has_vector 실패 {r.status_code}: {r.text[:300]}")


def fetch_active_version(client: httpx.Client) -> str:
    """vm5 model_versions.active=true base 버전. 없으면 roberta-va-v1."""
    url, _ = _ai()
    r = client.get(f"{url}/rest/v1/model_versions",
                   params={"select": "model_version", "active": "eq.true"},
                   headers=_ai_headers(), auth=_ai_auth(), timeout=60)
    if r.status_code in (200, 206):
        for row in r.json():
            mv = row.get("model_version", "")
            if mv and "::" not in mv:
                return mv
    return "roberta-va-v1"


def fetch_vectored_tmdbs(client: httpx.Client, version_axis: str) -> set:
    """vm4 movie_vectors에 해당 버전이 이미 있는 tmdb_id 집합."""
    url, key = _data()
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    out: set = set()
    offset = 0
    while True:
        r = client.get(f"{url}/rest/v1/movie_vectors",
                       params={"select": "tmdb_id", "vector_version": f"eq.{version_axis}",
                               "limit": 1000, "offset": offset},
                       headers=headers, auth=_data_auth(), timeout=60)
        if r.status_code not in (200, 206):
            break
        rows = r.json()
        out.update(x["tmdb_id"] for x in rows)
        if len(rows) < 1000:
            break
        offset += 1000
    return out


def reconcile_has_vector(client: httpx.Client, active_tmdbs: set) -> None:
    """vm4 movies.has_vector 보정. has_vector=true 인데 활성벡터 없는 영화 → false."""
    url, key = _data()
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    rows: list[dict] = []
    offset = 0
    while True:
        r = client.get(f"{url}/rest/v1/movies",
                       params={"select": "tmdb_id", "has_vector": "eq.true",
                               "limit": 1000, "offset": offset},
                       headers=headers, auth=_data_auth(), timeout=60)
        if r.status_code not in (200, 206):
            break
        batch = r.json()
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    stale = [r["tmdb_id"] for r in rows if r["tmdb_id"] not in active_tmdbs]
    for i in range(0, len(stale), BATCH_SIZE):
        chunk = stale[i:i + BATCH_SIZE]
        ids = ",".join(str(t) for t in chunk)
        client.patch(f"{url}/rest/v1/movies",
                     params={"tmdb_id": f"in.({ids})"},
                     json={"has_vector": False},
                     headers=_data_headers(), auth=_data_auth(), timeout=60)


def set_vector_state(client: httpx.Client, tmdb_ids: list[int]) -> None:
    """vm5 processing_status.vector_state='done' 배치 (멱등 원장)."""
    url, _ = _ai()
    for i in range(0, len(tmdb_ids), BATCH_SIZE):
        chunk = tmdb_ids[i:i + BATCH_SIZE]
        ids = ",".join(str(t) for t in chunk)
        h = {**_ai_headers(), "Content-Type": "application/json", "Prefer": "return=minimal"}
        r = client.patch(f"{url}/rest/v1/processing_status",
                         params={"tmdb_id": f"in.({ids})"},
                         json={"vector_state": "done"},
                         headers=h, auth=_ai_auth(), timeout=60)
        if r.status_code not in (200, 204):
            raise RuntimeError(f"vm5 vector_state 실패 {r.status_code}: {r.text[:300]}")
