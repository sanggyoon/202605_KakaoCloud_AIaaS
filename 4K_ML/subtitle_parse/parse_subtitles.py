#!/usr/bin/env python3
"""자막 파싱 배치 — vm5 subtitles → dialogues/scenes.

env: AI_DATABASE_URL, AI_DATABASE_KEY (선택 AI_BASIC_*), SCENE_* (선택)
"""
import httpx

from subtitle_parse import db
from subtitle_parse.srt import parse_srt
from subtitle_parse.features import line_features
from subtitle_parse.scenes import split_scenes, split_method, config_from_env
from subtitle_parse.embed import embed_texts


def parse_one(client, sub: dict, gap_ms: int, sim_threshold: float, min_lines: int, min_ms: int) -> int:
    """자막 1편을 파싱해 scenes/dialogues upsert. 반환: 씬 개수."""
    cues = parse_srt(sub["raw_text"])
    if not cues:
        raise ValueError("파싱된 cue 없음")
    feats = line_features(cues)
    emb = embed_texts([c.text for c in cues])
    groups = split_scenes(feats, emb, gap_ms, sim_threshold, min_lines, min_ms)

    total = feats[-1]["end_ms"] or 1
    method = split_method(gap_ms, sim_threshold, min_ms)
    scene_rows = []
    for si, g in enumerate(groups):
        first, last = feats[g[0]], feats[g[-1]]
        mid = (first["start_ms"] + last["end_ms"]) / 2
        scene_rows.append({
            "subtitles_id": sub["id"], "scene_index": si,
            "start_ms": first["start_ms"], "end_ms": last["end_ms"],
            "progress_ratio": mid / total,
            "text": " ".join(feats[i]["text"] for i in g),
            "dialogue_count": len(g), "split_method": method,
        })
    saved = db.upsert_scenes(client, scene_rows)
    sid_by_index = {row["scene_index"]: row["id"] for row in saved}

    dialogue_rows = []
    for si, g in enumerate(groups):
        for li in g:
            f = feats[li]
            dialogue_rows.append({
                "subtitles_id": sub["id"], "scenes_id": sid_by_index[si],
                "line_index": li, "start_ms": f["start_ms"], "end_ms": f["end_ms"],
                "duration_ms": f["duration_ms"], "text": f["text"],
                "char_count": f["char_count"], "word_count": f["word_count"],
                "gap_before_ms": f["gap_before_ms"], "progress_ratio": f["progress_ratio"],
            })
    db.upsert_dialogues(client, dialogue_rows)
    return len(groups)


def run() -> None:
    import os
    if not os.getenv("AI_DATABASE_URL"):
        raise SystemExit("AI_DATABASE_URL 환경변수가 필요합니다 (vm5).")
    gap_ms, sim_threshold, min_lines, min_ms = config_from_env()
    counts = {"done": 0, "failed": 0}
    with httpx.Client(timeout=60, verify=False) as client:
        targets = db.fetch_targets(client)
        for n, tmdb_id in enumerate(targets, 1):
            sub = db.fetch_subtitle(client, tmdb_id)
            if not sub:
                continue
            try:
                k = parse_one(client, sub, gap_ms, sim_threshold, min_lines, min_ms)
                db.set_parse_state(client, tmdb_id, "done")
                counts["done"] += 1
                print(f"[{n}/{len(targets)}] tmdb={tmdb_id} scenes={k}")
            except Exception as e:  # noqa: BLE001
                db.set_parse_state(client, tmdb_id, "failed", str(e)[:500])
                counts["failed"] += 1
                print(f"[{n}/{len(targets)}] tmdb={tmdb_id} FAILED: {e}")
    print(f"완료: {counts}")


if __name__ == "__main__":
    run()
