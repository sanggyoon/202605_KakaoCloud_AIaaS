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
