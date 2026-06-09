"""subdl 후보 중 영화당 1개를 고르는 순수 선택 로직 (네트워크 없음)."""


def is_srt(c: dict) -> bool:
    fmt = (c.get("format") or "").lower()
    if fmt:
        return fmt == "srt"
    return (c.get("name") or "").lower().endswith(".srt")


def is_sdh(c: dict) -> bool:
    return bool(c.get("hi"))


def _is_full_season(c: dict) -> bool:
    return bool(c.get("full_season"))


def _is_english(c: dict) -> bool:
    lang = (c.get("language") or c.get("lang") or "").lower()
    return lang in ("", "en", "english")


def choose(candidates: list[dict]) -> dict | None:
    """① EN·srt·단편 필터 → ② SDH 우선 → ③ subdl 반환순 1등. 없으면 None."""
    eligible = [
        c for c in candidates
        if _is_english(c) and is_srt(c) and not _is_full_season(c)
    ]
    if not eligible:
        return None
    sdh = [c for c in eligible if is_sdh(c)]
    return (sdh or eligible)[0]
