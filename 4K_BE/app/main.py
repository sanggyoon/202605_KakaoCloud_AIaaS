"""
4K Cinema Manager API
TMDB 영화 목록 조회 + Supabase 추가/삭제
"""
import os
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app import tmdb_common as tc

# 로컬 개발 편의: .env 자동 로드.
# 실제 운영(쿠버네티스)에서는 환경변수가 직접 주입되며, load_dotenv는
# 기본적으로 기존 환경변수를 덮어쓰지 않으므로(override=False) 안전하다.
_BASE_DIR = os.path.dirname(os.path.dirname(__file__))  # 4K_BE/
load_dotenv(os.path.join(_BASE_DIR, ".env"))
load_dotenv(os.path.join(_BASE_DIR, "DB_SCRIPTS", ".env"))

TMDB_KEY  = os.getenv("TMDB_API_KEY", "")
DATA_URL  = os.getenv("DATA_SUPABASE_URL", "https://data.peakly.art")
TMDB_BASE = "https://api.themoviedb.org/3"

app = FastAPI(title="4K Cinema Manager API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


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
                headers=tc.sb_headers(),
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


@app.get("/api/movies/search")
async def search_movies(q: str = "", page: int = 1):
    """
    TMDB 이름 검색 결과 + 각 영화의 Supabase 존재 여부 반환.
    list_movies와 동일한 응답 형태로 프론트가 그대로 재사용.
    """
    if not q.strip():
        return {"page": 1, "total_pages": 1, "movies": []}

    async with httpx.AsyncClient(timeout=15, verify=False) as client:
        r = await client.get(
            f"{TMDB_BASE}/search/movie",
            params={
                "api_key": TMDB_KEY,
                "language": "ko-KR",
                "include_adult": "false",
                "query": q,
                "page": page,
            },
        )
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail=f"TMDB 오류: {r.status_code}")
        data = r.json()

        movies = data.get("results", [])
        tmdb_ids = [m["id"] for m in movies]

        in_db_ids: set[int] = set()
        if tmdb_ids:
            ids_str = ",".join(str(i) for i in tmdb_ids)
            sb_r = await client.get(
                f"{DATA_URL}/rest/v1/movies",
                params={"select": "tmdb_id", "tmdb_id": f"in.({ids_str})"},
                headers=tc.sb_headers(),
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


@app.get("/api/movies/recent")
async def recent_movies(limit: int = 50):
    """최근 추가된 영화를 created_at 내림차순으로 반환 (매니저 '최근 추가 데이터' 화면용)."""
    limit = max(1, min(limit, 200))
    async with httpx.AsyncClient(timeout=15, verify=False) as client:
        r = await client.get(
            f"{tc.data_url()}/rest/v1/movies",
            params={
                "select": "tmdb_id,title,poster_path,release_year,has_vector,created_at",
                "order": "created_at.desc",
                "limit": str(limit),
            },
            headers=tc.sb_headers(),
        )
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Supabase 조회 실패: {r.text[:200]}")
        return {"movies": r.json()}


@app.get("/api/movies/{tmdb_id}/detail")
async def movie_detail(tmdb_id: int):
    """Supabase에서 영화 메타데이터(movies) + 클라이맥스 벡터(movie_vectors)를 조회."""
    async with httpx.AsyncClient(timeout=15, verify=False) as client:
        m_r = await client.get(
            f"{DATA_URL}/rest/v1/movies",
            params={"select": "*", "tmdb_id": f"eq.{tmdb_id}", "limit": "1"},
            headers=tc.sb_headers(),
        )
        if m_r.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Supabase 조회 실패: {m_r.text[:200]}")
        movie_rows = m_r.json()
        if not movie_rows:
            raise HTTPException(status_code=404, detail="DB에 저장되지 않은 영화입니다")

        v_r = await client.get(
            f"{DATA_URL}/rest/v1/movie_vectors",
            params={"select": "*", "tmdb_id": f"eq.{tmdb_id}", "limit": "1"},
            headers=tc.sb_headers(),
        )
        vector_row = v_r.json()[0] if v_r.status_code == 200 and v_r.json() else None

        return {"movie": movie_rows[0], "vector": vector_row}


# movies 테이블에서 클라이언트가 수정할 수 있는 컬럼 화이트리스트
_EDITABLE_FIELDS = {
    "title", "original_title", "imdb_id", "poster_path", "director",
    "release_year", "runtime", "genre", "actors", "overview", "youtube_key",
}


@app.patch("/api/movies/{tmdb_id}")
async def update_movie(tmdb_id: int, payload: dict):
    """
    영화 메타데이터(movies)와/또는 클라이맥스 벡터(movie_vectors)를 수정.
    payload = { "movie": {수정할 필드...}, "vector": [200개 float] }
    """
    movie_fields = payload.get("movie") or {}
    vector = payload.get("vector")

    # 화이트리스트에 있는 필드만 통과
    movie_update = {k: v for k, v in movie_fields.items() if k in _EDITABLE_FIELDS}

    async with httpx.AsyncClient(timeout=15, verify=False) as client:
        if movie_update:
            r = await client.patch(
                f"{DATA_URL}/rest/v1/movies",
                params={"tmdb_id": f"eq.{tmdb_id}"},
                json=movie_update,
                headers=tc.sb_headers(),
            )
            if r.status_code not in (200, 204):
                raise HTTPException(status_code=500, detail=f"메타데이터 수정 실패: {r.text[:200]}")

        if vector is not None:
            if not isinstance(vector, list) or not all(isinstance(x, (int, float)) for x in vector):
                raise HTTPException(status_code=400, detail="vector는 숫자 배열이어야 합니다")
            r = await client.patch(
                f"{DATA_URL}/rest/v1/movie_vectors",
                params={"tmdb_id": f"eq.{tmdb_id}"},
                json={"vector": vector},
                headers=tc.sb_headers(),
            )
            if r.status_code not in (200, 204):
                raise HTTPException(status_code=500, detail=f"벡터 수정 실패: {r.text[:200]}")

        return {"ok": True, "tmdb_id": tmdb_id}


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

        movie = tc.build_movie(d, tmdb_id)

        # on_conflict=tmdb_id 지정 — 이미 존재하는 영화면 PK가 아닌 tmdb_id
        # 유니크 제약 기준으로 merge(갱신)되도록 한다. (없으면 23505 중복키 오류)
        sb_r = await client.post(
            f"{DATA_URL}/rest/v1/movies",
            params={"on_conflict": "tmdb_id"},
            json=[movie],
            headers=tc.sb_headers(),
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
            headers=tc.sb_headers(),
        )
        if sb_r.status_code not in (200, 204):
            raise HTTPException(status_code=500, detail=f"Supabase 삭제 실패: {sb_r.text[:200]}")

        return {"ok": True, "tmdb_id": tmdb_id}
