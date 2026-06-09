import httpx
import pytest

from subtitle_fetch import db


@pytest.fixture
def mock_httpx(monkeypatch):
    """db 모듈의 httpx 호출을 가로채는 핸들러를 등록하는 픽스처."""
    real_client = httpx.Client
    state = {"handler": None}

    def set_handler(h):
        state["handler"] = h

    def fake_client(**kw):
        return real_client(transport=httpx.MockTransport(state["handler"]))

    def fake_request(method):
        def f(url, **k):
            # verify/auth/timeout은 Client 생성자 인자라 요청 메서드엔 못 넘김 → 제거
            for ctor_kw in ("verify", "auth", "timeout"):
                k.pop(ctor_kw, None)
            client = real_client(transport=httpx.MockTransport(state["handler"]))
            return getattr(client, method)(url, **k)
        return f

    monkeypatch.setattr(db.httpx, "Client", fake_client)
    monkeypatch.setattr(db.httpx, "get", fake_request("get"))
    monkeypatch.setattr(db.httpx, "post", fake_request("post"))
    return set_handler


def test_iter_movies_paginates(monkeypatch, mock_httpx):
    monkeypatch.setenv("DATA_SUPABASE_URL", "https://vm4")
    monkeypatch.setenv("DATA_SUPABASE_KEY", "k")
    pages = [[{"tmdb_id": 1}, {"tmdb_id": 2}], []]
    calls = {"n": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        i = calls["n"]
        calls["n"] += 1
        return httpx.Response(200, json=pages[min(i, len(pages) - 1)])

    mock_httpx(handler)
    assert list(db.iter_movies(page_size=2)) == [1, 2]


def test_get_state_returns_none_when_absent(monkeypatch, mock_httpx):
    monkeypatch.setenv("AI_DATABASE_URL", "https://vm5")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")
    mock_httpx(lambda req: httpx.Response(200, json=[]))
    assert db.get_state(999) is None


def test_get_state_uses_training_profile(monkeypatch, mock_httpx):
    monkeypatch.setenv("AI_DATABASE_URL", "https://vm5")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["profile"] = req.headers.get("accept-profile")
        return httpx.Response(200, json=[{"subtitle_state": "done"}])

    mock_httpx(handler)
    assert db.get_state(1) == "done"
    assert seen["profile"] == "training"


def test_save_subtitle_posts_row(monkeypatch, mock_httpx):
    monkeypatch.setenv("AI_DATABASE_URL", "https://vm5")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        import json
        seen["body"] = json.loads(req.content)
        seen["profile"] = req.headers.get("content-profile")
        return httpx.Response(201, json=[])

    mock_httpx(handler)
    db.save_subtitle(7, {"url": "/x.zip", "release_name": "R", "hi": 1}, "srt-text")
    assert seen["profile"] == "training"
    assert seen["body"][0]["tmdb_id"] == 7
    assert seen["body"][0]["is_sdh"] is True
    assert seen["body"][0]["raw_text"] == "srt-text"


def test_save_subtitle_raises_on_error(monkeypatch, mock_httpx):
    monkeypatch.setenv("AI_DATABASE_URL", "https://vm5")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")
    mock_httpx(lambda req: httpx.Response(400, text="bad"))
    with pytest.raises(RuntimeError):
        db.save_subtitle(7, {"url": "/x.zip", "hi": 0}, "t")
