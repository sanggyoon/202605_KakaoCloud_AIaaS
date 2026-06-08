"""TMDB 조회 / movies dict 빌드 / Supabase 조회·upsert 공통 모듈.
main.py 와 backfill_popular.py 가 공유한다.
"""
import os

TMDB_KEY  = os.getenv("TMDB_API_KEY", "")
DATA_URL  = os.getenv("DATA_SUPABASE_URL", "https://data.peakly.art")
DATA_KEY  = os.getenv("DATA_SUPABASE_KEY", "")
TMDB_BASE = "https://api.themoviedb.org/3"


def sb_headers(resolution: str = "merge-duplicates") -> dict:
    """Supabase PostgREST 헤더. resolution: merge-duplicates | ignore-duplicates."""
    return {
        "apikey": DATA_KEY,
        "Authorization": f"Bearer {DATA_KEY}",
        "Content-Type": "application/json",
        "Prefer": f"resolution={resolution},return=minimal",
    }


def pick_trailer(videos: list[dict]) -> str | None:
    """YouTube 트레일러 키: 한국어 트레일러 → 영어 트레일러 → 티저 순."""
    priority = [
        lambda v: v["site"] == "YouTube" and v["type"] == "Trailer" and v.get("iso_639_1") == "ko",
        lambda v: v["site"] == "YouTube" and v["type"] == "Trailer",
        lambda v: v["site"] == "YouTube" and v["type"] == "Teaser",
    ]
    for pred in priority:
        match = next((v for v in videos if pred(v)), None)
        if match:
            return match["key"]
    return None


def build_movie(d: dict, tmdb_id: int) -> dict:
    """TMDB 상세 응답 → movies 테이블 row dict."""
    crew = d.get("credits", {}).get("crew", [])
    director = next((c["name"] for c in crew if c["job"] == "Director"), None)
    actors = ", ".join(c["name"] for c in d.get("credits", {}).get("cast", [])[:5])
    release_year = None
    if d.get("release_date"):
        try:
            release_year = int(d["release_date"][:4])
        except ValueError:
            pass
    return {
        "tmdb_id":        tmdb_id,
        "imdb_id":        d.get("imdb_id"),
        "title":          d.get("title"),
        "original_title": d.get("original_title"),
        "poster_path":    d.get("poster_path"),
        "director":       director,
        "release_year":   release_year,
        "runtime":        d.get("runtime") or None,
        "genre":          ", ".join(g["name"] for g in d.get("genres", [])),
        "actors":         actors or None,
        "overview":       d.get("overview") or None,
        "youtube_key":    pick_trailer(d.get("videos", {}).get("results", [])),
    }
