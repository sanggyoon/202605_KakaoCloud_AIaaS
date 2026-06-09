from subtitle_fetch import select as sel


def test_choose_prefers_sdh():
    c = [{"name": "a.srt", "hi": 0}, {"name": "b.srt", "hi": 1}]
    assert sel.choose(c)["name"] == "b.srt"


def test_choose_filters_non_srt():
    assert sel.choose([{"name": "a.sub", "hi": 1}]) is None


def test_choose_fallback_to_non_sdh():
    c = [{"name": "a.srt", "hi": 0}]
    assert sel.choose(c)["name"] == "a.srt"


def test_choose_skips_full_season():
    assert sel.choose([{"name": "a.srt", "hi": 1, "full_season": True}]) is None


def test_choose_tiebreak_keeps_return_order():
    c = [{"name": "first.srt", "hi": 1}, {"name": "second.srt", "hi": 1}]
    assert sel.choose(c)["name"] == "first.srt"


def test_choose_empty_returns_none():
    assert sel.choose([]) is None
