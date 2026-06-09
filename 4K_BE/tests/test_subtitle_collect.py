import io
import zipfile

import pytest

from app import subtitle_collect as sc


def test_choose_prefers_sdh():
    c = [{"url": "/a.zip", "hi": 0}, {"url": "/b.zip", "hi": 1}]
    assert sc.choose(c)["url"] == "/b.zip"


def test_choose_filters_non_english():
    assert sc.choose([{"url": "/a.zip", "hi": 1, "language": "FR", "lang": "french"}]) is None


def test_choose_fallback_to_non_sdh():
    assert sc.choose([{"url": "/a.zip", "hi": 0}])["url"] == "/a.zip"


def test_choose_skips_full_season():
    assert sc.choose([{"url": "/a.zip", "hi": 1, "full_season": True}]) is None


def test_choose_empty_returns_none():
    assert sc.choose([]) is None


def test_largest_srt_picks_biggest():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("small.srt", "short")
        z.writestr("big.srt", "x" * 100)
        z.writestr("readme.txt", "ignore")
    assert sc._largest_srt(buf.getvalue()) == "x" * 100


def test_largest_srt_no_srt_raises():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("a.txt", "x")
    with pytest.raises(ValueError):
        sc._largest_srt(buf.getvalue())


def test_config_from_env_defaults(monkeypatch):
    monkeypatch.delenv("SUBTITLE_MAX_NEW", raising=False)
    monkeypatch.delenv("SUBTITLE_RATE_DELAY", raising=False)
    assert sc.config_from_env() == (100, 0.5)


import httpx


def _zip_bytes(text: str = "1\n00:00:01,000 --> 00:00:02,000\nHi\n") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("movie.srt", text)
    return buf.getvalue()


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_search_parses_and_ratelimit(monkeypatch):
    monkeypatch.setenv("SUBDL_API_KEY", "k")

    client = _client(lambda req: httpx.Response(
        200, json={"status": True, "subtitles": [{"url": "/a.zip", "hi": 1}]}))
    out = await sc.search(client, 27205)
    assert out[0]["url"] == "/a.zip"

    client = _client(lambda req: httpx.Response(429, json={}))
    with pytest.raises(sc.SubdlRateLimit):
        await sc.search(client, 1)


async def test_download_and_extract(monkeypatch):
    zb = _zip_bytes()
    client = _client(lambda req: httpx.Response(200, content=zb))
    text = await sc.download_and_extract(client, "/subtitle/1-2.zip")
    assert "Hi" in text


def _set_env(monkeypatch):
    monkeypatch.setenv("SUBDL_API_KEY", "k")
    monkeypatch.setenv("AI_DATABASE_URL", "https://ai.test")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")
    monkeypatch.setenv("DATA_SUPABASE_URL", "https://data.test")
    monkeypatch.setenv("DATA_SUPABASE_KEY", "k")


async def test_collect_events_happy(monkeypatch):
    _set_env(monkeypatch)
    zb = _zip_bytes()

    def handler(req: httpx.Request) -> httpx.Response:
        u = str(req.url)
        if "data.test/rest/v1/movies" in u:
            return httpx.Response(200, json=[{"tmdb_id": 100}])
        if "ai.test/rest/v1/processing_status" in u and req.method == "GET":
            return httpx.Response(200, json=[])
        if "api.subdl.com" in u:
            return httpx.Response(200, json={"status": True,
                "subtitles": [{"url": "/s.zip", "release_name": "R", "hi": True, "language": "EN"}]})
        if "dl.subdl.com" in u:
            return httpx.Response(200, content=zb)
        if "ai.test/rest/v1/subtitles" in u and req.method == "POST":
            return httpx.Response(201, json=[])
        if "ai.test/rest/v1/processing_status" in u and req.method == "POST":
            return httpx.Response(201, json=[])
        return httpx.Response(404)

    client = _client(handler)
    events = [ev async for ev in sc.collect_events(client, max_new=100, rate_delay=0)]
    assert events[-1]["type"] == "done"
    assert events[-1]["added"] == 1
    assert any(e["type"] == "progress" for e in events)


async def test_collect_events_skips_terminal_states(monkeypatch):
    # done·skipped·failed(retry>=3)는 종료 상태 → subdl/저장 호출 없이 건너뜀(handler 500이면 실패)
    _set_env(monkeypatch)

    def handler(req: httpx.Request) -> httpx.Response:
        u = str(req.url)
        if "data.test/rest/v1/movies" in u:
            return httpx.Response(200, json=[{"tmdb_id": 1}, {"tmdb_id": 2}, {"tmdb_id": 3}])
        if "ai.test/rest/v1/processing_status" in u and req.method == "GET":
            return httpx.Response(200, json=[
                {"tmdb_id": 1, "subtitle_state": "done", "retry_count": 0},
                {"tmdb_id": 2, "subtitle_state": "skipped", "retry_count": 0},
                {"tmdb_id": 3, "subtitle_state": "failed", "retry_count": 3},
            ])
        return httpx.Response(500)

    client = _client(handler)
    events = [ev async for ev in sc.collect_events(client, max_new=100, rate_delay=0)]
    assert events == [{"type": "done", "added": 0, "skipped": 0, "failed": []}]


async def test_collect_events_retries_failed_under_cap(monkeypatch):
    # failed retry_count=1 (<3) → 재시도 대상
    _set_env(monkeypatch)
    zb = _zip_bytes()

    def handler(req: httpx.Request) -> httpx.Response:
        u = str(req.url)
        if "data.test/rest/v1/movies" in u:
            return httpx.Response(200, json=[{"tmdb_id": 5}])
        if "ai.test/rest/v1/processing_status" in u and req.method == "GET":
            return httpx.Response(200, json=[{"tmdb_id": 5, "subtitle_state": "failed", "retry_count": 1}])
        if "api.subdl.com" in u:
            return httpx.Response(200, json={"status": True,
                "subtitles": [{"url": "/s.zip", "hi": True, "language": "EN"}]})
        if "dl.subdl.com" in u:
            return httpx.Response(200, content=zb)
        return httpx.Response(201, json=[])

    client = _client(handler)
    events = [ev async for ev in sc.collect_events(client, max_new=100, rate_delay=0)]
    assert events[-1]["added"] == 1


async def test_collect_events_increments_retry_on_failure(monkeypatch):
    # failed(retry 1) 영화가 또 실패 → status POST에 retry_count=2 기록
    _set_env(monkeypatch)
    posted = {}

    def handler(req: httpx.Request) -> httpx.Response:
        import json
        u = str(req.url)
        if "data.test/rest/v1/movies" in u:
            return httpx.Response(200, json=[{"tmdb_id": 5}])
        if "ai.test/rest/v1/processing_status" in u and req.method == "GET":
            return httpx.Response(200, json=[{"tmdb_id": 5, "subtitle_state": "failed", "retry_count": 1}])
        if "api.subdl.com" in u:
            return httpx.Response(200, json={"status": True,
                "subtitles": [{"url": "/s.zip", "hi": True, "language": "EN"}]})
        if "dl.subdl.com" in u:
            return httpx.Response(500, text="boom")  # 다운로드 실패
        if "ai.test/rest/v1/processing_status" in u and req.method == "POST":
            posted.update(json.loads(req.content)[0])
            return httpx.Response(201, json=[])
        return httpx.Response(201, json=[])

    client = _client(handler)
    events = [ev async for ev in sc.collect_events(client, max_new=100, rate_delay=0)]
    assert events[-1]["failed"] == [5]
    assert posted["subtitle_state"] == "failed"
    assert posted["retry_count"] == 2


async def test_remaining_counts(monkeypatch):
    _set_env(monkeypatch)

    def handler(req: httpx.Request) -> httpx.Response:
        u = str(req.url)
        if "data.test/rest/v1/movies" in u:
            return httpx.Response(200, json=[{"tmdb_id": 1}, {"tmdb_id": 2}, {"tmdb_id": 3}])
        if "ai.test/rest/v1/processing_status" in u and req.method == "GET":
            return httpx.Response(200, json=[
                {"tmdb_id": 1, "subtitle_state": "done", "retry_count": 0},
                {"tmdb_id": 2, "subtitle_state": "failed", "retry_count": 1},
            ])
        return httpx.Response(500)

    client = _client(handler)
    counts = await sc.remaining_counts(client)
    # 1=done(종료), 2=failed1(미종료), 3=상태없음(미종료) → remaining 2
    assert counts == {"total": 3, "terminal": 1, "remaining": 2}


async def test_collect_events_respects_max_new(monkeypatch):
    _set_env(monkeypatch)
    zb = _zip_bytes()

    def handler(req: httpx.Request) -> httpx.Response:
        u = str(req.url)
        if "data.test/rest/v1/movies" in u:
            return httpx.Response(200, json=[{"tmdb_id": 1}, {"tmdb_id": 2}, {"tmdb_id": 3}])
        if "ai.test/rest/v1/processing_status" in u and req.method == "GET":
            return httpx.Response(200, json=[])
        if "api.subdl.com" in u:
            return httpx.Response(200, json={"status": True,
                "subtitles": [{"url": "/s.zip", "hi": True, "language": "EN"}]})
        if "dl.subdl.com" in u:
            return httpx.Response(200, content=zb)
        return httpx.Response(201, json=[])

    client = _client(handler)
    events = [ev async for ev in sc.collect_events(client, max_new=2, rate_delay=0)]
    assert events[-1]["added"] == 2
    assert sum(1 for e in events if e["type"] == "progress") == 2
