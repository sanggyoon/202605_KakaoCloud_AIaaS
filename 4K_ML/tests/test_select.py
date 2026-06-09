from subtitle_fetch import select as sel


def test_choose_prefers_sdh():
    c = [{"url": "/a.zip", "hi": 0}, {"url": "/b.zip", "hi": 1}]
    assert sel.choose(c)["url"] == "/b.zip"


def test_choose_filters_non_english():
    # subdl 응답은 language='EN'/lang='english'. 다른 언어는 제외.
    assert sel.choose([{"url": "/a.zip", "hi": 1, "language": "FR", "lang": "french"}]) is None


def test_choose_fallback_to_non_sdh():
    c = [{"url": "/a.zip", "hi": 0}]
    assert sel.choose(c)["url"] == "/a.zip"


def test_choose_skips_full_season():
    assert sel.choose([{"url": "/a.zip", "hi": 1, "full_season": True}]) is None


def test_choose_tiebreak_keeps_return_order():
    c = [{"url": "/first.zip", "hi": 1}, {"url": "/second.zip", "hi": 1}]
    assert sel.choose(c)["url"] == "/first.zip"


def test_choose_empty_returns_none():
    assert sel.choose([]) is None
