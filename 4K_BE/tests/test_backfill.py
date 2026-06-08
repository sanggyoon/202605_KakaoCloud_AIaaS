import httpx
from app import backfill_popular as bf


def _make_handler(existing_ids, discover_pages):
    """existing_ids: set, discover_pages: {page_int: [movie_dict,...]}"""
    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if "/rest/v1/movies" in url and req.method == "GET":
            return httpx.Response(200, json=[{"tmdb_id": i} for i in existing_ids])
        if "/discover/movie" in url:
            page = int(req.url.params.get("page", "1"))
            return httpx.Response(200, json={"results": discover_pages.get(page, [])})
        if "/movie/" in url and req.method == "GET":
            tid = int(url.split("/movie/")[1].split("?")[0])
            return httpx.Response(200, json={"title": f"M{tid}", "credits": {}, "videos": {}})
        if "/rest/v1/movies" in url and req.method == "POST":
            return httpx.Response(201, json=[])
        return httpx.Response(404, json={})
    return handler


async def _run(handler, max_new, max_pages=10):
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
        return await bf.run_backfill(c, max_new=max_new, max_pages=max_pages, rate_delay=0)


async def test_adds_only_missing_and_stops_at_max_new():
    handler = _make_handler(
        existing_ids={1, 2},
        discover_pages={1: [{"id": 1}, {"id": 2}, {"id": 3}, {"id": 4}]},
    )
    result = await _run(handler, max_new=1)
    assert result["added"] == 1


async def test_idempotent_when_all_exist():
    handler = _make_handler(
        existing_ids={1, 2, 3},
        discover_pages={1: [{"id": 1}, {"id": 2}, {"id": 3}]},
    )
    result = await _run(handler, max_new=100)
    assert result["added"] == 0


async def test_paginates_until_max_new():
    handler = _make_handler(
        existing_ids=set(),
        discover_pages={1: [{"id": 10}, {"id": 11}], 2: [{"id": 12}, {"id": 13}]},
    )
    result = await _run(handler, max_new=3)
    assert result["added"] == 3


async def test_stops_when_discover_empty():
    handler = _make_handler(existing_ids=set(), discover_pages={1: [{"id": 10}]})
    result = await _run(handler, max_new=100, max_pages=10)
    assert result["added"] == 1


async def test_records_failed_fetches():
    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if "/rest/v1/movies" in url and req.method == "GET":
            return httpx.Response(200, json=[])
        if "/discover/movie" in url:
            page = int(req.url.params.get("page", "1"))
            results = [{"id": 20}, {"id": 21}] if page == 1 else []
            return httpx.Response(200, json={"results": results})
        if "/movie/20" in url and req.method == "GET":
            return httpx.Response(404, json={})
        if "/movie/" in url and req.method == "GET":
            tid = int(url.split("/movie/")[1].split("?")[0])
            return httpx.Response(200, json={"title": f"M{tid}", "credits": {}, "videos": {}})
        if "/rest/v1/movies" in url and req.method == "POST":
            return httpx.Response(201, json=[])
        return httpx.Response(404, json={})
    result = await _run(handler, max_new=100)
    assert result["added"] == 1       # 21만 성공
    assert result["failed"] == [20]   # 20은 fetch 404


async def test_respects_max_pages():
    handler = _make_handler(
        existing_ids=set(),
        discover_pages={1: [{"id": 10}, {"id": 11}], 2: [{"id": 12}]},
    )
    result = await _run(handler, max_new=100, max_pages=1)
    assert result["added"] == 2       # page 1만 처리
