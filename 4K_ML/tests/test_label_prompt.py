from labeling.prompt import RUBRIC, OUTPUT_SCHEMA, build_user_message


def test_user_message_includes_indexed_scenes():
    scenes = [
        {"scenes_id": 10, "scene_index": 0, "text": "alpha beta"},
        {"scenes_id": 11, "scene_index": 1, "text": "gamma"},
    ]
    msg = build_user_message(scenes)
    assert "[0]" in msg and "alpha beta" in msg
    assert "[1]" in msg and "gamma" in msg


def test_rubric_mentions_both_axes():
    assert "Arousal" in RUBRIC and "Valence" in RUBRIC


def test_output_schema_has_only_two_axes():
    item = OUTPUT_SCHEMA["properties"]["scenes"]["items"]
    assert set(item["required"]) == {"scene_index", "arousal", "valence"}
    assert "reason" not in item["properties"]
    assert item["additionalProperties"] is False
