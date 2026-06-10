"""순수 .srt 파서 → list[Cue]. <태그> 제거, 멀티라인 합치기, SDH 대괄호 유지."""
import re
from dataclasses import dataclass

_TIME = re.compile(r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})")
_TAG = re.compile(r"<[^>]+>")


@dataclass
class Cue:
    index: int
    start_ms: int
    end_ms: int
    text: str


def _ts_to_ms(ts: str) -> int | None:
    m = _TIME.search(ts)
    if not m:
        return None
    h, mm, s, ms = (int(x) for x in m.groups())
    return ((h * 60 + mm) * 60 + s) * 1000 + ms


def parse_srt(raw_text: str) -> list[Cue]:
    cues: list[Cue] = []
    blocks = re.split(r"\r?\n\r?\n+", raw_text.strip())
    idx = 0
    for block in blocks:
        lines = [ln for ln in block.splitlines() if ln.strip() != ""]
        timing_i = next((i for i, ln in enumerate(lines) if "-->" in ln), None)
        if timing_i is None:
            continue
        parts = lines[timing_i].split("-->")
        if len(parts) != 2:
            continue
        start, end = _ts_to_ms(parts[0]), _ts_to_ms(parts[1])
        if start is None or end is None:
            continue
        text = " ".join(_TAG.sub("", t) for t in lines[timing_i + 1:]).strip()
        if not text:
            continue
        cues.append(Cue(index=idx, start_ms=start, end_ms=end, text=text))
        idx += 1
    return cues
