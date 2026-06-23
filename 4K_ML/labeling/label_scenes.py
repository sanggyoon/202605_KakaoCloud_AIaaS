#!/usr/bin/env python3
"""LLM 라벨링 배치 — vm5 scenes → scene_scores(Valence+Arousal).

env: AI_DATABASE_URL, AI_DATABASE_KEY (선택 AI_BASIC_*), ANTHROPIC_API_KEY,
     선택 LABEL_BATCH_ID(크래시 후 기존 배치 이어받기).
"""
import os

import httpx
from anthropic import Anthropic

from labeling import db, batch


def _clamp(x) -> float:
    return max(0.0, min(1.0, float(x)))


def parse_to_rows(parsed: dict, index_to_sid: dict[int, int]) -> list[dict]:
    """LLM 응답 → scene_scores 행(씬당 arousal/valence 2행). 매핑 없는 씬은 스킵."""
    rows = []
    for s in parsed["scenes"]:
        sid = index_to_sid.get(s["scene_index"])
        if sid is None:
            continue
        rows.append({"scenes_id": sid, "score": _clamp(s["arousal"]),
                     "model_version": db.AROUSAL_MV})
        rows.append({"scenes_id": sid, "score": _clamp(s["valence"]),
                     "model_version": db.VALENCE_MV})
    return rows


def run() -> None:
    if not os.getenv("AI_DATABASE_URL"):
        raise SystemExit("AI_DATABASE_URL 환경변수가 필요합니다 (vm5).")
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise SystemExit("ANTHROPIC_API_KEY 환경변수가 필요합니다.")
    ac = Anthropic()
    counts = {"done": 0, "failed": 0}
    with httpx.Client(timeout=60) as client:
        db.ensure_model_versions(client)
        targets = db.fetch_label_targets(client)
        movies, sid_maps = [], {}
        for tmdb_id in targets:
            scenes = db.fetch_scenes(client, tmdb_id)
            if not scenes:
                continue
            movies.append((tmdb_id, scenes))
            sid_maps[tmdb_id] = {s["scene_index"]: s["scenes_id"] for s in scenes}
        if not movies:
            print("대상 없음")
            return

        batch_id = os.getenv("LABEL_BATCH_ID") or batch.submit(ac, batch.build_requests(movies))
        batch.poll(ac, batch_id)

        for tmdb_id, parsed, error in batch.collect(ac, batch_id):
            if error:
                db.set_label_state(client, tmdb_id, "failed", error[:500])
                counts["failed"] += 1
                print(f"tmdb={tmdb_id} FAILED: {error}")
                continue
            try:
                rows = parse_to_rows(parsed, sid_maps.get(tmdb_id, {}))
                db.upsert_scene_scores(client, rows)
                db.set_label_state(client, tmdb_id, "done")
                counts["done"] += 1
                print(f"tmdb={tmdb_id} scenes_scored={len(rows) // 2}")
            except Exception as e:  # noqa: BLE001
                db.set_label_state(client, tmdb_id, "failed", str(e)[:500])
                counts["failed"] += 1
                print(f"tmdb={tmdb_id} FAILED: {e}")
    print(f"완료: {counts}")


if __name__ == "__main__":
    run()
