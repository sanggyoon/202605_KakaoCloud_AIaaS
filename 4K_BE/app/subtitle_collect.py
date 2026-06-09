"""subdl 자막 수집 — 매니저 버튼/스트리밍과 (추후)CronJob이 공유.

핵심 로직은 `collect_events` async 제너레이터에 있고 진행 이벤트를 yield한다.
vm4 movies에서 vm5 processing_status가 done 아닌 영화만 골라 자막을 수집한다.
"""
import io
import os
import zipfile


SUBDL_API = "https://api.subdl.com/api/v1/subtitles"
SUBDL_DL = "https://dl.subdl.com"


class SubdlRateLimit(Exception):
    """subdl 일일 한도 초과/429."""


def config_from_env() -> tuple[int, float]:
    """(max_new, rate_delay) — 버튼 1회 수집량과 요청 간 지연."""
    return (
        int(os.getenv("SUBTITLE_MAX_NEW", "100")),
        float(os.getenv("SUBTITLE_RATE_DELAY", "0.5")),
    )


# ── 선택 로직 (순수) ──────────────────────────────────────────────

def is_sdh(c: dict) -> bool:
    return bool(c.get("hi"))


def _is_full_season(c: dict) -> bool:
    return bool(c.get("full_season"))


def _is_english(c: dict) -> bool:
    lang = (c.get("language") or c.get("lang") or "").lower()
    return lang in ("", "en", "english")


def choose(candidates: list[dict]) -> dict | None:
    """영어·단편 필터 → SDH 우선 → subdl 반환순 1등. 없으면 None.
    (subdl 검색은 format 미제공·name이 .zip이라 srt 필터는 안 함 — srt는 추출 단계 보장.)"""
    eligible = [c for c in candidates if _is_english(c) and not _is_full_season(c)]
    if not eligible:
        return None
    sdh = [c for c in eligible if is_sdh(c)]
    return (sdh or eligible)[0]


def _largest_srt(zip_bytes: bytes) -> str:
    """zip에서 가장 큰 .srt 텍스트(utf-8, 실패 시 latin-1)."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        srts = [n for n in z.namelist() if n.lower().endswith(".srt")]
        if not srts:
            raise ValueError("zip에 .srt 파일이 없음")
        biggest = max(srts, key=lambda n: z.getinfo(n).file_size)
        raw = z.read(biggest)
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("latin-1")
