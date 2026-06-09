"""subdl 후보 중 영화당 1개를 고르는 순수 선택 로직 (네트워크 없음).

subdl 검색 응답은 포맷(`format`)을 주지 않고 `name`이 .zip이다. 실제 .srt는 zip 안에 있어
다운로드(`download_and_extract`) 단계에서 추출·검증한다. 따라서 선택 단계에선 srt 필터를
걸지 않고, 영어·단편(full_season 아님) 필터 + SDH 우선만 적용한다.
"""


def is_sdh(c: dict) -> bool:
    return bool(c.get("hi"))


def _is_full_season(c: dict) -> bool:
    return bool(c.get("full_season"))


def _is_english(c: dict) -> bool:
    lang = (c.get("language") or c.get("lang") or "").lower()
    return lang in ("", "en", "english")


def choose(candidates: list[dict]) -> dict | None:
    """① EN·단편 필터 → ② SDH 우선 → ③ subdl 반환순 1등. 없으면 None."""
    eligible = [
        c for c in candidates
        if _is_english(c) and not _is_full_season(c)
    ]
    if not eligible:
        return None
    sdh = [c for c in eligible if is_sdh(c)]
    return (sdh or eligible)[0]
