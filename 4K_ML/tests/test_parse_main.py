import numpy as np

from subtitle_parse import parse_subtitles as main

SRT = (
    "1\n00:00:01,000 --> 00:00:02,000\nalpha\n\n"
    "2\n00:00:02,200 --> 00:00:03,000\nbeta\n\n"
    "3\n00:00:03,200 --> 00:00:04,000\ngamma\n\n"
    "4\n00:00:20,000 --> 00:00:21,000\ndelta\n"   # 큰 gap → 새 씬
)


def test_parse_one_builds_scenes_and_dialogues(monkeypatch):
    monkeypatch.setattr(main, "embed_texts", lambda texts: np.ones((len(texts), 2)))

    posted = {"scenes": None, "dialogues": None}

    def fake_upsert_scenes(client, rows):
        posted["scenes"] = rows
        return [{"id": 100 + r["scene_index"], "scene_index": r["scene_index"]} for r in rows]

    def fake_upsert_dialogues(client, rows):
        posted["dialogues"] = rows

    monkeypatch.setattr(main.db, "upsert_scenes", fake_upsert_scenes)
    monkeypatch.setattr(main.db, "upsert_dialogues", fake_upsert_dialogues)

    # min_ms를 작게(1000) 두어 첫 3줄(≈3초) 후 큰 gap에서 분할되게 함
    n = main.parse_one(None, {"id": 7, "tmdb_id": 7, "raw_text": SRT},
                       gap_ms=3000, sim_threshold=0.5, min_lines=3, min_ms=1000)

    assert n == 2
    assert [s["scene_index"] for s in posted["scenes"]] == [0, 1]
    assert posted["scenes"][0]["dialogue_count"] == 3
    assert posted["scenes"][1]["dialogue_count"] == 1
    assert [d["line_index"] for d in posted["dialogues"]] == [0, 1, 2, 3]
    assert posted["dialogues"][0]["scenes_id"] == 100
    assert posted["dialogues"][3]["scenes_id"] == 101
    assert posted["dialogues"][0]["subtitles_id"] == 7


def test_parse_one_raises_on_empty(monkeypatch):
    monkeypatch.setattr(main, "embed_texts", lambda texts: np.ones((len(texts), 2)))
    import pytest
    with pytest.raises(ValueError):
        main.parse_one(None, {"id": 1, "tmdb_id": 1, "raw_text": "garbage"},
                       gap_ms=3000, sim_threshold=0.5, min_lines=3, min_ms=1000)
