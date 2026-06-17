"""
4K Cinema Manager API
TMDB 영화 목록 조회 + Supabase 추가/삭제
"""
import hashlib
import json
import os
import secrets
from datetime import datetime, timedelta, timezone

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app import tmdb_common as tc
from app import backfill_popular as bf
from app import subtitle_collect as sc
from app import jobs

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


@app.post("/api/movies/backfill")
async def backfill_now(limit: int | None = None):
    """매니저 영화 수집 — 백그라운드 잡 시작, 즉시 잡 상태 반환. limit=수량(미지정 시 env)."""
    default_max, max_pages, rate_delay = bf.config_from_env()
    max_new = default_max if limit is None else max(1, min(limit, 2000))
    return jobs.start("movie", lambda client: bf.backfill_events(client, max_new, max_pages, rate_delay))


@app.post("/api/subtitles/collect")
async def subtitles_collect(limit: int | None = None):
    """매니저 자막 수집 — 백그라운드 잡 시작, 즉시 잡 상태 반환. limit=수량(미지정 시 env)."""
    default_max, rate_delay = sc.config_from_env()
    max_new = default_max if limit is None else max(1, min(limit, 2000))
    return jobs.start("subtitle", lambda client: sc.collect_events(client, max_new, rate_delay))


@app.get("/api/jobs/{job_type}")
async def job_status(job_type: str):
    """매니저 폴링용 — 수동 수집 잡의 진행도/로그/에러."""
    return jobs.get(job_type)


@app.get("/api/subtitles/remaining")
async def subtitles_remaining():
    """수집 가능한(종료 상태 아닌) 영화 수 — 매니저 입력칸의 최대치 표시용."""
    async with httpx.AsyncClient(timeout=30, verify=False) as client:
        return await sc.remaining_counts(client)


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

        processing = await _movie_processing(client, tmdb_id)
        return {"movie": movie_rows[0], "vector": vector_row, "processing": processing}


@app.post("/api/movies/{tmdb_id}/reprocess")
async def reprocess_movie(tmdb_id: int):
    """단건 자막 강제 재수집 → 성공 시 parse/score/vector 리셋(크론·GPU가 재처리)."""
    async with httpx.AsyncClient(timeout=120, verify=False) as client:
        result = await sc.collect_one(client, tmdb_id)
        if result["state"] == "done":
            await sc.reset_downstream(client, tmdb_id)
        return {"subtitle": result["state"], "message": result["message"]}


async def _active_base(client: httpx.AsyncClient) -> str:
    url = os.getenv("AI_DATABASE_URL", "")
    key = os.getenv("AI_DATABASE_KEY", "")
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    bu = os.getenv("AI_BASIC_USER")
    auth = (bu, os.getenv("AI_BASIC_PASS", "")) if bu else None
    r = await client.get(f"{url}/rest/v1/model_versions",
                         params={"select": "model_version", "active": "eq.true"},
                         headers=h, auth=auth)
    if r.status_code in (200, 206):
        for row in r.json():
            mv = row.get("model_version", "")
            if mv and "::" not in mv:
                return mv
    return "roberta-va-v1"


async def _movie_processing(client: httpx.AsyncClient, tmdb_id: int) -> dict:
    """vm5: 한 영화의 상태(5개+retry) + 개수(scenes/dialogues/활성 score)."""
    url = os.getenv("AI_DATABASE_URL", "")
    key = os.getenv("AI_DATABASE_KEY", "")
    if not url or not key:
        return {}
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    bu = os.getenv("AI_BASIC_USER")
    auth = (bu, os.getenv("AI_BASIC_PASS", "")) if bu else None

    async def _count(table, params):
        ch = {**h, "Prefer": "count=exact", "Range-Unit": "items", "Range": "0-0"}
        r = await client.get(f"{url}/rest/v1/{table}", params={"select": "id", **params},
                             headers=ch, auth=auth)
        return _parse_count(r.headers.get("content-range")) if r.status_code in (200, 206) else 0

    ps = await client.get(f"{url}/rest/v1/processing_status",
                          params={"select": "subtitle_state,parse_state,label_state,score_state,vector_state,retry_count",
                                  "tmdb_id": f"eq.{tmdb_id}", "limit": "1"}, headers=h, auth=auth)
    states = (ps.json()[0] if ps.status_code in (200, 206) and ps.json() else {})

    subs = await client.get(f"{url}/rest/v1/subtitles",
                            params={"select": "id", "tmdb_id": f"eq.{tmdb_id}", "limit": "1"},
                            headers=h, auth=auth)
    sid = subs.json()[0]["id"] if subs.status_code in (200, 206) and subs.json() else None
    scenes = dialogues = scores_active = 0
    if sid is not None:
        scenes = await _count("scenes", {"subtitles_id": f"eq.{sid}"})
        dialogues = await _count("dialogues", {"subtitles_id": f"eq.{sid}"})
        sc_rows = await client.get(f"{url}/rest/v1/scenes",
                                   params={"select": "id", "subtitles_id": f"eq.{sid}", "limit": "100000"},
                                   headers=h, auth=auth)
        ids = [r["id"] for r in (sc_rows.json() if sc_rows.status_code in (200, 206) else [])]
        if ids:
            mv = await _active_base(client)
            in_list = ",".join(str(i) for i in ids)
            ss = await client.get(f"{url}/rest/v1/scene_scores",
                                  params={"select": "scenes_id", "scenes_id": f"in.({in_list})",
                                          "model_version": f"eq.{mv}::arousal", "limit": "100000"},
                                  headers=h, auth=auth)
            scores_active = len(ss.json()) if ss.status_code in (200, 206) else 0
    return {"states": states, "counts": {"scenes": scenes, "dialogues": dialogues,
                                         "scores_active": scores_active}}


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


async def _reset_processing(client: httpx.AsyncClient, tmdb_id: int) -> None:
    """vm5 processing_status를 pending으로 리셋(best-effort)."""
    url = os.getenv("AI_DATABASE_URL", "")
    key = os.getenv("AI_DATABASE_KEY", "")
    if not url or not key:
        return
    h = {"apikey": key, "Authorization": f"Bearer {key}",
         "Content-Type": "application/json",
         "Prefer": "resolution=merge-duplicates,return=minimal"}
    bu = os.getenv("AI_BASIC_USER")
    auth = (bu, os.getenv("AI_BASIC_PASS", "")) if bu else None
    row = {"tmdb_id": tmdb_id, "subtitle_state": "pending", "parse_state": "pending",
           "label_state": "pending", "score_state": "pending", "vector_state": "pending",
           "retry_count": 0, "error": None,
           "updated_at": datetime.now(timezone.utc).isoformat()}
    try:
        await client.post(f"{url}/rest/v1/processing_status",
                          params={"on_conflict": "tmdb_id"}, json=[row], headers=h, auth=auth)
    except Exception:  # noqa: BLE001 — best-effort
        pass


@app.delete("/api/movies/{tmdb_id}")
async def delete_movie(tmdb_id: int):
    """vm4 movies 삭제 + vm4 movie_vectors 삭제 + vm5 processing_status pending 리셋."""
    async with httpx.AsyncClient(timeout=15, verify=False) as client:
        sb_r = await client.delete(
            f"{DATA_URL}/rest/v1/movies",
            params={"tmdb_id": f"eq.{tmdb_id}"},
            headers=tc.sb_headers(),
        )
        if sb_r.status_code not in (200, 204):
            raise HTTPException(status_code=500, detail=f"Supabase 삭제 실패: {sb_r.text[:200]}")

        # vm4 벡터 삭제 (best-effort)
        try:
            await client.delete(f"{DATA_URL}/rest/v1/movie_vectors",
                                params={"tmdb_id": f"eq.{tmdb_id}"}, headers=tc.sb_headers())
        except Exception:  # noqa: BLE001
            pass

        # vm5 처리상태 pending 리셋 (best-effort)
        await _reset_processing(client, tmdb_id)

        return {"ok": True, "tmdb_id": tmdb_id}


@app.post("/api/visits")
async def log_visit(payload: dict):
    """공개 서비스 방문 기록 — FE 비콘이 브라우저당 하루 1회 호출한다."""
    visitor_id = (payload.get("visitor_id") or "").strip()
    if not visitor_id:
        raise HTTPException(status_code=400, detail="visitor_id is required")
    async with httpx.AsyncClient(timeout=15, verify=False) as client:
        r = await client.post(
            f"{tc.data_url()}/rest/v1/visits",
            json=[{"visitor_id": visitor_id}],
            headers=tc.sb_headers(),
        )
        if r.status_code not in (200, 201, 204):
            raise HTTPException(status_code=500, detail=f"방문 기록 실패: {r.text[:200]}")
    return {"ok": True}


def _parse_count(content_range: str | None) -> int:
    """PostgREST count 응답의 Content-Range("0-0/1234" 또는 "*/0")에서 total 파싱."""
    if not content_range or "/" not in content_range:
        return 0
    total = content_range.rsplit("/", 1)[-1]
    return int(total) if total.isdigit() else 0


async def _count(client: httpx.AsyncClient, table: str, params: dict) -> int:
    """Supabase 테이블의 행 수를 count=exact 헤더로 조회."""
    headers = tc.sb_headers()
    headers["Prefer"] = "count=exact"
    headers["Range-Unit"] = "items"
    headers["Range"] = "0-0"
    r = await client.get(
        f"{tc.data_url()}/rest/v1/{table}",
        params={"select": "id", **params},
        headers=headers,
    )
    if r.status_code not in (200, 206):
        return 0
    return _parse_count(r.headers.get("content-range"))


@app.get("/api/active-model")
async def active_model():
    """현재 활성 모델 base 버전. vm5 model_versions.active=true 의 base(::없는) 버전."""
    url = os.getenv("AI_DATABASE_URL", "")
    key = os.getenv("AI_DATABASE_KEY", "")
    if url and key:
        headers = {"apikey": key, "Authorization": f"Bearer {key}"}
        bu = os.getenv("AI_BASIC_USER")
        auth = (bu, os.getenv("AI_BASIC_PASS", "")) if bu else None
        async with httpx.AsyncClient(timeout=15, verify=False) as client:
            r = await client.get(
                f"{url}/rest/v1/model_versions",
                params={"select": "model_version,metrics", "active": "eq.true"},
                headers=headers, auth=auth,
            )
            if r.status_code in (200, 206):
                for row in r.json():
                    mv = row.get("model_version", "")
                    if mv and "::" not in mv:
                        return {"version": mv, "metrics": row.get("metrics") or {}}
    return {"version": "roberta-va-v1", "metrics": {}}  # 폴백


PROC_STATES = ["subtitle_state", "parse_state", "label_state", "score_state", "vector_state"]


async def _processing_counts(client: httpx.AsyncClient) -> dict:
    """vm5 processing_status의 단계별 상태값 개수 집계 (null은 pending으로 버킷)."""
    url = os.getenv("AI_DATABASE_URL", "")
    key = os.getenv("AI_DATABASE_KEY", "")
    if not url or not key:
        return {}
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    bu = os.getenv("AI_BASIC_USER")
    auth = (bu, os.getenv("AI_BASIC_PASS", "")) if bu else None
    result: dict = {s: {} for s in PROC_STATES}
    offset, page = 0, 1000
    while True:
        r = await client.get(
            f"{url}/rest/v1/processing_status",
            params={"select": ",".join(PROC_STATES), "limit": page, "offset": offset},
            headers=headers,
            auth=auth,
        )
        if r.status_code not in (200, 206):
            break
        rows = r.json()
        for row in rows:
            for s in PROC_STATES:
                v = row.get(s) or "pending"
                result[s][v] = result[s].get(v, 0) + 1
        if len(rows) < page:
            break
        offset += page
    return result


@app.get("/api/visits/range")
async def visits_range(start: str, end: str):
    """기간 [start, end] (YYYY-MM-DD, 양끝 포함) 방문자 수."""
    try:
        s = datetime.strptime(start, "%Y-%m-%d").date()
        e = datetime.strptime(end, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="날짜 형식은 YYYY-MM-DD")
    if s > e:
        raise HTTPException(status_code=400, detail="시작일이 종료일보다 늦습니다")
    e_plus = e + timedelta(days=1)
    cond = f"(created_at.gte.{s.isoformat()}T00:00:00,created_at.lt.{e_plus.isoformat()}T00:00:00)"
    async with httpx.AsyncClient(timeout=15, verify=False) as client:
        count = await _count(client, "visits", {"and": cond})
    return {"start": start, "end": end, "count": count}


@app.get("/api/stats")
async def stats():
    """매니저 모니터링용 집계 — 방문자(기간별) + vm5 처리 현황(단계별 상태값 개수)."""
    now = datetime.now(timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = now - timedelta(days=7)
    month_start = now - timedelta(days=30)

    async with httpx.AsyncClient(timeout=15, verify=False) as client:
        total_v = await _count(client, "visits", {})
        month_v = await _count(client, "visits", {"created_at": f"gte.{month_start.isoformat()}"})
        week_v = await _count(client, "visits", {"created_at": f"gte.{week_start.isoformat()}"})
        day_v = await _count(client, "visits", {"created_at": f"gte.{day_start.isoformat()}"})
        processing = await _processing_counts(client)

    return {
        "visitors": {"total": total_v, "month": month_v, "week": week_v, "day": day_v},
        "processing": processing,
    }


# ── 고객별 API 키 (vm4 api_keys, service_role) ──────────────────
@app.post("/api/api-keys")
async def create_api_key(payload: dict):
    name = (payload or {}).get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name이 필요합니다")
    plaintext = f"peakly_{secrets.token_urlsafe(24)}"
    key_hash = hashlib.sha256(plaintext.encode()).hexdigest()
    key_prefix = plaintext[:12]
    async with httpx.AsyncClient(timeout=15, verify=False) as client:
        r = await client.post(
            f"{DATA_URL}/rest/v1/api_keys",
            json=[{"name": name, "key_hash": key_hash, "key_prefix": key_prefix}],
            headers={**tc.sb_headers(), "Prefer": "return=representation"},
        )
        if r.status_code not in (200, 201):
            raise HTTPException(status_code=500, detail=f"키 저장 실패: {r.text[:200]}")
        row = r.json()[0]
    return {
        "id": row["id"],
        "name": row["name"],
        "key": plaintext,          # 평문은 이 응답에서만 1회 노출
        "key_prefix": row["key_prefix"],
        "created_at": row["created_at"],
    }


@app.get("/api/api-keys")
async def list_api_keys():
    async with httpx.AsyncClient(timeout=15, verify=False) as client:
        r = await client.get(
            f"{DATA_URL}/rest/v1/api_keys",
            params={
                "select": "id,name,key_prefix,active,created_at,last_used_at",
                "order": "created_at.desc",
            },
            headers=tc.sb_headers(),
        )
        if r.status_code not in (200, 206):
            raise HTTPException(status_code=500, detail=f"키 목록 실패: {r.text[:200]}")
        return r.json()


@app.delete("/api/api-keys/{key_id}")
async def revoke_api_key(key_id: int):
    async with httpx.AsyncClient(timeout=15, verify=False) as client:
        r = await client.patch(
            f"{DATA_URL}/rest/v1/api_keys",
            params={"id": f"eq.{key_id}"},
            json={"active": False},
            headers={**tc.sb_headers(), "Prefer": "return=representation"},
        )
        if r.status_code not in (200, 204):
            raise HTTPException(status_code=500, detail=f"키 폐기 실패: {r.text[:200]}")
        rows = r.json() if r.text else []
        if not rows:
            raise HTTPException(status_code=404, detail="키를 찾을 수 없습니다")
    return {"ok": True, "id": key_id}
