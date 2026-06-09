import io
import zipfile

import httpx
import pytest

from subtitle_fetch import subdl_client as subdl


def test_largest_srt_picks_biggest():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("small.srt", "short")
        z.writestr("big.srt", "x" * 100)
        z.writestr("readme.txt", "ignore")
    assert subdl._largest_srt(buf.getvalue()) == "x" * 100


def test_largest_srt_no_srt_raises():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("a.txt", "x")
    with pytest.raises(ValueError):
        subdl._largest_srt(buf.getvalue())


def test_search_parses_subtitles(monkeypatch):
    monkeypatch.setenv("SUBDL_API_KEY", "k")

    def handler(req: httpx.Request) -> httpx.Response:
        assert "api.subdl.com" in str(req.url)
        assert req.url.params["tmdb_id"] == "123"
        return httpx.Response(200, json={"status": True, "subtitles": [{"name": "a.srt", "hi": 1}]})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    out = subdl.search(123, client)
    assert out[0]["name"] == "a.srt"


def test_search_raises_ratelimit_on_429(monkeypatch):
    monkeypatch.setenv("SUBDL_API_KEY", "k")

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    with pytest.raises(subdl.SubdlRateLimit):
        subdl.search(1, client)


def test_download_and_extract_returns_srt_text(monkeypatch):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("movie.srt", "1\n00:00:01,000 --> 00:00:02,000\nHi\n")
    zip_bytes = buf.getvalue()

    def handler(req: httpx.Request) -> httpx.Response:
        assert "dl.subdl.com" in str(req.url)
        return httpx.Response(200, content=zip_bytes)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    text = subdl.download_and_extract("/subtitle/1-2.zip", client)
    assert "Hi" in text
