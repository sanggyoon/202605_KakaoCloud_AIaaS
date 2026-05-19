"""
4K Cinema Manager API
TMDB 영화 목록 조회 + Supabase 추가/삭제
"""
import os
from pathlib import Path
from dotenv import load_dotenv
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

load_dotenv(Path(__file__).parent.parent / "DB_SCRIPTS" / ".env")

TMDB_KEY  = os.getenv("TMDB_API_KEY", "")
DATA_URL  = os.getenv("DATA_SUPABASE_URL", "https://data.4kakao.kro.kr")
DATA_KEY  = os.getenv("DATA_SUPABASE_KEY", "")
TMDB_BASE = "https://api.themoviedb.org/3"

app = FastAPI(title="4K Cinema Manager API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _sb_headers() -> dict:
    return {
        "apikey": DATA_KEY,
        "Authorization": f"Bearer {DATA_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }


def _pick_trailer(videos: list[dict]) -> str | None:
    """YouTube 트레일러 키 우선순위 선택: 한국어 트레일러 → 영어 트레일러 → 티저"""
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


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/api/movies")
async def list_movies(page: int = 1):
    """
    TMDB 최신 영화 목록 + 각 영화의 Supabase 존재 여부 반환.
    vote_count.gte=10 으로 소규모 영화 필터링.
    """
    async with httpx.AsyncClient(timeout=15, verify=False) as client:
        # TMDB discover (최신 개봉순)
        r = await client.get(
            f"{TMDB_BASE}/discover/movie",
            params={
                "api_key": TMDB_KEY,
                "language": "ko-KR",
                "sort_by": "release_date.desc",
                "include_adult": "false",
                "include_video": "false",
                "vote_count.gte": "10",
                "page": page,
            },
        )
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail=f"TMDB 오류: {r.status_code}")
        data = r.json()

        movies = data.get("results", [])
        tmdb_ids = [m["id"] for m in movies]

        # Supabase에서 해당 페이지의 tmdb_id들 중 DB에 있는 것 확인
        in_db_ids: set[int] = set()
        if tmdb_ids:
            ids_str = ",".join(str(i) for i in tmdb_ids)
            sb_r = await client.get(
                f"{DATA_URL}/rest/v1/movies",
                params={"select": "tmdb_id", "tmdb_id": f"in.({ids_str})"},
                headers=_sb_headers(),
            )
            if sb_r.status_code == 200:
                in_db_ids = {row["tmdb_id"] for row in sb_r.json()}

        return {
            "page": data.get("page", 1),
            "total_pages": min(data.get("total_pages", 1), 500),
            "movies": [
                {
                    "tmdb_id":        m["id"],
                    "title":          m.get("title", ""),
                    "original_title": m.get("original_title", ""),
                    "poster_path":    m.get("poster_path"),
                    "release_date":   m.get("release_date", ""),
                    "overview":       m.get("overview", ""),
                    "in_db":          m["id"] in in_db_ids,
                }
                for m in movies
            ],
        }


@app.post("/api/movies/{tmdb_id}")
async def add_movie(tmdb_id: int):
    """TMDB에서 상세 정보를 가져와 Supabase에 upsert"""
    async with httpx.AsyncClient(timeout=15, verify=False) as client:
        r = await client.get(
            f"{TMDB_BASE}/movie/{tmdb_id}",
            params={
                "api_key": TMDB_KEY,
                "language": "ko-KR",
                "append_to_response": "credits,videos",
            },
        )
        if r.status_code == 404:
            raise HTTPException(status_code=404, detail="TMDB에서 영화를 찾을 수 없습니다")
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail=f"TMDB 오류: {r.status_code}")
        d = r.json()

        crew     = d.get("credits", {}).get("crew", [])
        director = next((c["name"] for c in crew if c["job"] == "Director"), None)
        actors   = ", ".join(c["name"] for c in d.get("credits", {}).get("cast", [])[:5])
        trailer  = _pick_trailer(d.get("videos", {}).get("results", []))

        release_year = None
        if d.get("release_date"):
            try:
                release_year = int(d["release_date"][:4])
            except ValueError:
                pass

        movie = {
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
            "youtube_key":    trailer,
        }

        sb_r = await client.post(
            f"{DATA_URL}/rest/v1/movies",
            json=[movie],
            headers=_sb_headers(),
        )
        if sb_r.status_code not in (200, 201, 204):
            raise HTTPException(status_code=500, detail=f"Supabase 저장 실패: {sb_r.text[:200]}")

        return {"ok": True, "tmdb_id": tmdb_id, "title": movie["title"]}


@app.delete("/api/movies/{tmdb_id}")
async def delete_movie(tmdb_id: int):
    """Supabase에서 영화 삭제"""
    async with httpx.AsyncClient(timeout=15, verify=False) as client:
        sb_r = await client.delete(
            f"{DATA_URL}/rest/v1/movies",
            params={"tmdb_id": f"eq.{tmdb_id}"},
            headers=_sb_headers(),
        )
        if sb_r.status_code not in (200, 204):
            raise HTTPException(status_code=500, detail=f"Supabase 삭제 실패: {sb_r.text[:200]}")

        return {"ok": True, "tmdb_id": tmdb_id}
