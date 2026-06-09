"""subdl API 검색 + zip 다운로드/.srt 추출 + rate-limit 감지."""
import io
import os
import zipfile

import httpx

API_URL = "https://api.subdl.com/api/v1/subtitles"
DL_BASE = "https://dl.subdl.com"


class SubdlRateLimit(Exception):
    """subdl 일일 한도 초과/429."""


def _api_key() -> str:
    key = os.getenv("SUBDL_API_KEY", "")
    if not key:
        raise SystemExit("SUBDL_API_KEY 환경변수가 필요합니다.")
    return key


def search(tmdb_id: int, client: httpx.Client) -> list[dict]:
    """tmdb_id로 영어 영화 자막 후보 목록을 반환."""
    r = client.get(
        API_URL,
        params={
            "api_key": _api_key(),
            "tmdb_id": tmdb_id,
            "type": "movie",
            "languages": "EN",
            "subs_per_page": 30,
            "hi": 1,
            "releases": 1,
        },
    )
    if r.status_code == 429:
        raise SubdlRateLimit("subdl 429")
    r.raise_for_status()
    data = r.json()
    if isinstance(data, dict) and data.get("status") is False:
        msg = str(data.get("error", "")).lower()
        if "limit" in msg or "quota" in msg:
            raise SubdlRateLimit(msg)
        return []
    return data.get("subtitles", []) if isinstance(data, dict) else []


def download_and_extract(url_path: str, client: httpx.Client) -> str:
    """자막 zip을 받아 가장 큰 .srt 텍스트를 반환."""
    url = url_path if url_path.startswith("http") else f"{DL_BASE}{url_path}"
    r = client.get(url)
    if r.status_code == 429:
        raise SubdlRateLimit("subdl download 429")
    r.raise_for_status()
    return _largest_srt(r.content)


def _largest_srt(zip_bytes: bytes) -> str:
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
