from subtitle_parse.srt import parse_srt, Cue

BASIC = """1
00:00:01,000 --> 00:00:02,500
Hello there.

2
00:00:04,000 --> 00:00:06,000
General Kenobi.
"""


def test_parses_two_cues():
    cues = parse_srt(BASIC)
    assert cues == [
        Cue(index=0, start_ms=1000, end_ms=2500, text="Hello there."),
        Cue(index=1, start_ms=4000, end_ms=6000, text="General Kenobi."),
    ]


def test_joins_multiline_and_strips_tags():
    srt = "1\n00:00:01,000 --> 00:00:02,000\n<i>first</i>\nsecond\n"
    assert parse_srt(srt)[0].text == "first second"


def test_keeps_sdh_brackets():
    srt = "1\n00:00:01,000 --> 00:00:02,000\n[explosion]\n"
    assert parse_srt(srt)[0].text == "[explosion]"


def test_skips_malformed_block_and_reindexes():
    srt = ("1\n00:00:01,000 --> 00:00:02,000\nok one\n\n"
           "garbage block no timing\n\n"
           "3\n00:00:05,000 --> 00:00:06,000\nok two\n")
    cues = parse_srt(srt)
    assert [c.text for c in cues] == ["ok one", "ok two"]
    assert [c.index for c in cues] == [0, 1]


def test_skips_empty_text_cue():
    srt = "1\n00:00:01,000 --> 00:00:02,000\n\n2\n00:00:03,000 --> 00:00:04,000\nhi\n"
    assert [c.text for c in parse_srt(srt)] == ["hi"]
