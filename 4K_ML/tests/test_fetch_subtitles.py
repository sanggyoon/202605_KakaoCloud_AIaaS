import pytest

from subtitle_fetch import fetch_subtitles as main


def _patch_common(monkeypatch, statuses, saved):
    monkeypatch.setattr(main.db, "get_state", lambda t: None)
    monkeypatch.setattr(main.db, "set_status",
                        lambda t, s, error=None: statuses.append((s, error)))
    monkeypatch.setattr(main.db, "save_subtitle",
                        lambda t, c, r: saved.append((t, bool(c.get("hi")), r)))


def test_process_movie_done(monkeypatch):
    statuses, saved = [], []
    _patch_common(monkeypatch, statuses, saved)
    monkeypatch.setattr(main.subdl, "search",
                        lambda t, http: [{"name": "a.srt", "hi": 1, "url": "/x.zip", "release_name": "R"}])
    monkeypatch.setattr(main.subdl, "download_and_extract",
                        lambda url, http: "1\n00:00:01,000 --> 00:00:02,000\nHi\n")
    assert main.process_movie(None, 123) == "done"
    assert saved == [(123, True, "1\n00:00:01,000 --> 00:00:02,000\nHi\n")]
    assert statuses == [("done", None)]


def test_process_movie_skipped_when_no_candidate(monkeypatch):
    statuses, saved = [], []
    _patch_common(monkeypatch, statuses, saved)
    monkeypatch.setattr(main.subdl, "search", lambda t, http: [])  # subdl 후보 없음
    assert main.process_movie(None, 1) == "skipped"
    assert statuses == [("skipped", None)]


def test_process_movie_failed_on_error(monkeypatch):
    statuses, saved = [], []
    _patch_common(monkeypatch, statuses, saved)

    def boom(t, http):
        raise RuntimeError("net down")

    monkeypatch.setattr(main.subdl, "search", boom)
    assert main.process_movie(None, 1) == "failed"
    assert statuses[0][0] == "failed" and "net down" in statuses[0][1]


def test_process_movie_ratelimit_propagates(monkeypatch):
    statuses, saved = [], []
    _patch_common(monkeypatch, statuses, saved)

    def rl(t, http):
        raise main.subdl.SubdlRateLimit("limit")

    monkeypatch.setattr(main.subdl, "search", rl)
    with pytest.raises(main.subdl.SubdlRateLimit):
        main.process_movie(None, 1)


def test_process_movie_cached(monkeypatch):
    monkeypatch.setattr(main.db, "get_state", lambda t: "done")
    assert main.process_movie(None, 1) == "cached"
