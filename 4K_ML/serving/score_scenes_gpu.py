#!/usr/bin/env python3
"""GPU 인프로세스 배치 스코어링(수동) — 활성모델 직접 로드, KServe 미사용.

env: AI_DATABASE_URL, AI_DATABASE_KEY (선택 AI_BASIC_*), MODEL_BASE_DIR(기본 /models)
실행(수동): argo submit --from workflowtemplate/score-scenes-gpu -n ai
"""
import os

import httpx

from serving import db, predict_core


def _clamp01(x) -> float:
    return float(min(1.0, max(0.0, float(x))))


def scene_score_rows(scenes: list[dict], preds: list[dict], mv: str) -> list[dict]:
    """씬 + 예측 → scene_scores upsert 행(축별). (순수)"""
    rows: list[dict] = []
    for s, p in zip(scenes, preds):
        rows.append({"scenes_id": s["scenes_id"], "score": _clamp01(p["arousal"]),
                     "model_version": f"{mv}::arousal"})
        rows.append({"scenes_id": s["scenes_id"], "score": _clamp01(p["valence"]),
                     "model_version": f"{mv}::valence"})
    return rows


def run() -> None:
    if not os.getenv("AI_DATABASE_URL") or not os.getenv("AI_DATABASE_KEY"):
        raise SystemExit("AI_DATABASE_URL, AI_DATABASE_KEY 필요 (vm5).")
    base = os.getenv("MODEL_BASE_DIR", "/models")
    counts = {"done": 0, "failed": 0}
    with httpx.Client(timeout=60, verify=False) as client:
        mv = db.fetch_active_version(client)
        model_dir = f"{base}/{mv}"
        print(f"=== GPU 배치 스코어링: 활성모델 {mv} ({model_dir}) ===")
        model, scaler, tok, cfg = predict_core.load_artifacts(model_dir)
        max_len = int(cfg.get("max_len", 512))
        db.ensure_model_versions(client, mv)
        targets = db.fetch_score_targets(client)
        print(f"  대상 {len(targets):,}편")
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
                preds = predict_core.score_instances(model, scaler, tok, max_len, instances)
                db.upsert_scene_scores(client, scene_score_rows(scenes, preds, mv))
                db.set_score_state(client, tmdb_id, "done")
                counts["done"] += 1
            except Exception as e:  # 한 편 실패해도 계속(멱등 재실행 가능)
                counts["failed"] += 1
                print(f"  [실패] tmdb={tmdb_id}: {e}")
    print(f"✅ done={counts['done']} failed={counts['failed']}")


if __name__ == "__main__":
    run()
