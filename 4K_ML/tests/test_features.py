from subtitle_parse.srt import Cue
from subtitle_parse.features import line_features


def test_features_basic():
    cues = [
        Cue(0, 1000, 2000, "hello world"),
        Cue(1, 5000, 6000, "[boom]"),
    ]
    f = line_features(cues)
    assert f[0]["gap_before_ms"] is None
    assert f[0]["duration_ms"] == 1000
    assert f[0]["char_count"] == len("hello world")
    assert f[0]["word_count"] == 2
    assert f[1]["gap_before_ms"] == 3000          # 5000 - 2000
    assert f[1]["word_count"] == 1
    # progress_ratio: 마지막 cue end=6000 기준, cue0 중앙=1500
    assert abs(f[0]["progress_ratio"] - (1500 / 6000)) < 1e-9


def test_empty():
    assert line_features([]) == []
