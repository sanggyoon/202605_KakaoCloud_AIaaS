"""Sonnet 라벨링용 루브릭·메시지·출력 스키마 (Valence + Arousal, 0~1 절대 앵커)."""

RUBRIC = """You score movie scenes on two emotional axes, each 0.0-1.0, using ABSOLUTE anchors.
You see the entire movie's scenes at once; use the whole-movie context to order scenes
relatively, but keep the anchors absolute (a calm movie should score low overall).

Arousal (intensity / excitement / tension):
  0.0 static or calm (background, mundane dialogue, transitions)
  0.3 mild stirring (seeds of conflict)
  0.6 elevated (confrontation, danger, chase)
  0.9-1.0 peak (climax, maximum action or clash)

Valence (emotional positivity / negativity):
  0.0 very negative (fear, tragedy, despair, death)
  0.5 neutral (factual, ordinary conversation)
  1.0 very positive (joy, triumph, love, reconciliation)

Return a score for EVERY scene by its scene_index. Output only the two numbers per scene.
"""

OUTPUT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["scenes"],
    "properties": {
        "scenes": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["scene_index", "arousal", "valence"],
                "properties": {
                    "scene_index": {"type": "integer"},
                    "arousal": {"type": "number"},
                    "valence": {"type": "number"},
                },
            },
        }
    },
}


def build_user_message(scenes: list[dict]) -> str:
    """씬 목록을 '[scene_index] text' 줄로 직렬화."""
    lines = [f"[{s['scene_index']}] {s['text']}" for s in scenes]
    return "Score every scene below.\n\n" + "\n".join(lines)
