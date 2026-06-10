"""cue별 보조 피처 (순수). 다운스트림 dialogues 컬럼과 1:1."""
from subtitle_parse.srt import Cue


def line_features(cues: list[Cue]) -> list[dict]:
    if not cues:
        return []
    total = cues[-1].end_ms or 1
    out = []
    prev_end = None
    for c in cues:
        mid = (c.start_ms + c.end_ms) / 2
        out.append({
            "start_ms": c.start_ms,
            "end_ms": c.end_ms,
            "duration_ms": c.end_ms - c.start_ms,
            "text": c.text,
            "char_count": len(c.text),
            "word_count": len(c.text.split()),
            "gap_before_ms": None if prev_end is None else max(0, c.start_ms - prev_end),
            "progress_ratio": mid / total,
        })
        prev_end = c.end_ms
    return out
