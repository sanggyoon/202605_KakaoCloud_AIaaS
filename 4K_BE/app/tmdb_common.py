"""TMDB 조회 / movies dict 빌드 / Supabase 조회·upsert 공통 모듈.
main.py 와 backfill_popular.py 가 공유한다.
"""
import os

import httpx

TMDB_BASE = "https://api.themoviedb.org/3"


def _tmdb_key() -> str:
    return os.getenv("TMDB_API_KEY", "")


def data_url() -> str:
    return os.getenv("DATA_SUPABASE_URL", "https://data.peakly.art")


def _data_key() -> str:
    return os.getenv("DATA_SUPABASE_KEY", "")


def sb_headers(resolution: str = "merge-duplicates") -> dict:
    """Supabase PostgREST 헤더. resolution 값은 PostgREST에 그대로 전달된다
    (예: merge-duplicates, ignore-duplicates)."""
    key = _data_key()
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
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


async def tmdb_discover(client: httpx.AsyncClient, sort_by: str = "popularity.desc",
                        page: int = 1) -> list[dict]:
    """TMDB discover 한 페이지의 results 리스트 반환. 오류 시 빈 리스트."""
    r = await client.get(
        f"{TMDB_BASE}/discover/movie",
        params={
            "api_key": _tmdb_key(),
            "language": "ko-KR",
            "sort_by": sort_by,
            "include_adult": "false",
            "include_video": "false",
            "vote_count.gte": "10",
            "page": page,
        },
    )
    if r.status_code != 200:
        return []
    return r.json().get("results", [])


async def fetch_movie(client: httpx.AsyncClient, tmdb_id: int) -> dict | None:
    """TMDB 상세 → movies row dict. 오류(404 등) 시 None."""
    r = await client.get(
        f"{TMDB_BASE}/movie/{tmdb_id}",
        params={"api_key": _tmdb_key(), "language": "ko-KR",
                "append_to_response": "credits,videos"},
    )
    if r.status_code != 200:
        return None
    return build_movie(r.json(), tmdb_id)


async def get_existing_tmdb_ids(client: httpx.AsyncClient) -> set[int]:
    """movies 테이블의 모든 tmdb_id 집합. 조회 실패 시 빈 set."""
    r = await client.get(
        f"{data_url()}/rest/v1/movies",
        params={"select": "tmdb_id", "limit": "100000"},
        headers=sb_headers(),
    )
    if r.status_code != 200:
        return set()
    return {row["tmdb_id"] for row in r.json()}


async def upsert_movies(client: httpx.AsyncClient, rows: list[dict],
                        resolution: str = "ignore-duplicates") -> bool:
    """movies 배열 upsert. on_conflict=tmdb_id. 성공 여부 반환."""
    if not rows:
        return True
    r = await client.post(
        f"{data_url()}/rest/v1/movies",
        params={"on_conflict": "tmdb_id"},
        json=rows,
        headers=sb_headers(resolution),
    )
    return r.status_code in (200, 201, 204)
