from app import tmdb_common as tc


def test_pick_trailer_prefers_korean_youtube_trailer():
    videos = [
        {"site": "YouTube", "type": "Teaser", "iso_639_1": "en", "key": "teaser"},
        {"site": "YouTube", "type": "Trailer", "iso_639_1": "en", "key": "en_trailer"},
        {"site": "YouTube", "type": "Trailer", "iso_639_1": "ko", "key": "ko_trailer"},
    ]
    assert tc.pick_trailer(videos) == "ko_trailer"


def test_pick_trailer_returns_none_when_no_match():
    assert tc.pick_trailer([{"site": "Vimeo", "type": "Trailer", "key": "x"}]) is None


def test_build_movie_maps_fields():
    detail = {
        "imdb_id": "tt001",
        "title": "기생충",
        "original_title": "Parasite",
        "poster_path": "/p.jpg",
        "release_date": "2019-05-30",
        "runtime": 132,
        "genres": [{"name": "Drama"}, {"name": "Thriller"}],
        "overview": "줄거리",
        "credits": {
            "crew": [{"job": "Director", "name": "봉준호"}],
            "cast": [{"name": f"배우{i}"} for i in range(7)],
        },
        "videos": {"results": [{"site": "YouTube", "type": "Trailer", "iso_639_1": "ko", "key": "K"}]},
    }
    row = tc.build_movie(detail, 496243)
    assert row["tmdb_id"] == 496243
    assert row["title"] == "기생충"
    assert row["director"] == "봉준호"
    assert row["release_year"] == 2019
    assert row["genre"] == "Drama, Thriller"
    assert row["actors"] == "배우0, 배우1, 배우2, 배우3, 배우4"
    assert row["youtube_key"] == "K"


def test_build_movie_handles_missing_fields():
    row = tc.build_movie({"credits": {}, "videos": {}}, 1)
    assert row["tmdb_id"] == 1
    assert row["director"] is None
    assert row["release_year"] is None
    assert row["actors"] is None
    assert row["youtube_key"] is None


import httpx
from app import tmdb_common as tc


def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_tmdb_discover_returns_results():
    def handler(req: httpx.Request) -> httpx.Response:
        assert "/discover/movie" in str(req.url)
        assert req.url.params["sort_by"] == "popularity.desc"
        return httpx.Response(200, json={"results": [{"id": 1}, {"id": 2}]})
    async with _client(handler) as c:
        out = await tc.tmdb_discover(c, sort_by="popularity.desc", page=1)
    assert [m["id"] for m in out] == [1, 2]


async def test_fetch_movie_builds_row():
    def handler(req: httpx.Request) -> httpx.Response:
        assert "/movie/99" in str(req.url)
        return httpx.Response(200, json={"title": "T", "credits": {}, "videos": {}})
    async with _client(handler) as c:
        row = await tc.fetch_movie(c, 99)
    assert row["tmdb_id"] == 99 and row["title"] == "T"


async def test_fetch_movie_returns_none_on_error():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={})
    async with _client(handler) as c:
        assert await tc.fetch_movie(c, 99) is None


async def test_get_existing_tmdb_ids_parses_rows():
    def handler(req: httpx.Request) -> httpx.Response:
        assert "/rest/v1/movies" in str(req.url)
        return httpx.Response(200, json=[{"tmdb_id": 1}, {"tmdb_id": 5}])
    async with _client(handler) as c:
        ids = await tc.get_existing_tmdb_ids(c)
    assert ids == {1, 5}


async def test_upsert_movies_sends_ignore_duplicates():
    seen = {}
    def handler(req: httpx.Request) -> httpx.Response:
        seen["prefer"] = req.headers.get("Prefer", "")
        seen["conflict"] = req.url.params.get("on_conflict")
        return httpx.Response(201, json=[])
    async with _client(handler) as c:
        ok = await tc.upsert_movies(c, [{"tmdb_id": 1}], resolution="ignore-duplicates")
    assert ok is True
    assert "ignore-duplicates" in seen["prefer"]
    assert seen["conflict"] == "tmdb_id"
