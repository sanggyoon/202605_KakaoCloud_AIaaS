#!/usr/bin/env python3
"""배치 스코어링 — vm5 점수없는 영화 → KServe predict → scene_scores 적재.

env: AI_DATABASE_URL, AI_DATABASE_KEY (선택 AI_BASIC_*),
     KSERVE_PREDICT_URL(예: http://roberta-va-predictor.ai.svc.cluster.local/v1/models/roberta-va:predict)
"""
import os

import httpx

from serving import db


def call_predictor(url: str, instances: list[dict]) -> dict:
    """KServe predict 호출 → {"predictions":[...], "model_version":...}."""
    r = httpx.post(url, json={"instances": instances}, timeout=120)
    r.raise_for_status()
    return r.json()


def _clamp01(x) -> float:
    return float(min(1.0, max(0.0, float(x))))


def run() -> None:
    if not os.getenv("AI_DATABASE_URL"):
        raise SystemExit("AI_DATABASE_URL 환경변수가 필요합니다 (vm5).")
    predict_url = os.getenv("KSERVE_PREDICT_URL")
    if not predict_url:
        raise SystemExit("KSERVE_PREDICT_URL 환경변수가 필요합니다.")

    counts = {"done": 0, "failed": 0}
    ensured: set[str] = set()
    with httpx.Client(timeout=60) as client:
        targets = db.fetch_score_targets(client)
        for tmdb_id in targets:
            try:
                scenes = db.fetch_movie_scenes_for_scoring(client, tmdb_id)
                if not scenes:
                    db.set_score_state(client, tmdb_id, "done")
                    counts["done"] += 1
                    continue
                instances = [{
                    "text": s["text"], "progress_ratio": s["progress_ratio"],
                    "start_ms": s["start_ms"], "end_ms": s["end_ms"],
                    "dialogue_count": s["dialogue_count"],
                    "avg_gap_before_ms": s["avg_gap_before_ms"],
                } for s in scenes]
                resp = call_predictor(predict_url, instances)
                mv = resp["model_version"]
                if mv not in ensured:
                    db.ensure_model_versions(client, mv)
                    ensured.add(mv)
                preds = resp["predictions"]
                rows = []
                for s, p in zip(scenes, preds):
                    rows.append({"scenes_id": s["scenes_id"], "score": _clamp01(p["arousal"]),
                                 "model_version": f"{mv}::arousal"})
                    rows.append({"scenes_id": s["scenes_id"], "score": _clamp01(p["valence"]),
                                 "model_version": f"{mv}::valence"})
                db.upsert_scene_scores(client, rows)
                db.set_score_state(client, tmdb_id, "done")
                counts["done"] += 1
                print(f"tmdb={tmdb_id} scenes_scored={len(scenes)} mv={mv}")
            except Exception as e:  # noqa: BLE001
                db.set_score_state(client, tmdb_id, "failed", str(e)[:500])
                counts["failed"] += 1
                print(f"tmdb={tmdb_id} FAILED: {e}")
    print(f"완료: {counts}")


if __name__ == "__main__":
    run()
