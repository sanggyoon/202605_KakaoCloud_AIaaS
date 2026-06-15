import httpx
import pytest

from app import subtitle_collect as sc


def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def _fake_dl(client, url_path):
    return "1\n00:00:01,000 --> 00:00:03,000\nhello\n"


@pytest.mark.asyncio
async def test_collect_one_done_and_reset(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "https://ai.test")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")
    monkeypatch.setenv("SUBDL_API_KEY", "s")
    posted = []

    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if "api.subdl.com" in url:  # search
            return httpx.Response(200, json={"subtitles": [
                {"url": "/subtitle/x.zip", "language": "EN", "lang": "english", "hi": True,
                 "release_name": "X", "full_season": False}]})
        if "/rest/v1/subtitles" in url:
            return httpx.Response(201, json=[])
        if "/rest/v1/processing_status" in url:
            posted.append(req.content.decode())
            return httpx.Response(201, json=[])
        return httpx.Response(404)

    monkeypatch.setattr(sc, "download_and_extract", _fake_dl)
    async with _client(handler) as c:
        res = await sc.collect_one(c, 100)
        await sc.reset_downstream(c, 100)
    assert res["state"] == "done"
    assert any("parse_state" in p and "pending" in p for p in posted)


@pytest.mark.asyncio
async def test_collect_one_skipped_when_no_subtitle(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "https://ai.test")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")
    monkeypatch.setenv("SUBDL_API_KEY", "s")

    def handler(req):
        if "api.subdl.com" in str(req.url):
            return httpx.Response(200, json={"subtitles": []})
        return httpx.Response(201, json=[])

    async with _client(handler) as c:
        res = await sc.collect_one(c, 100)
    assert res["state"] == "skipped"
