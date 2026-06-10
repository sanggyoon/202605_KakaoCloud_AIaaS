import types

from labeling import batch


def test_build_requests_one_per_movie():
    movies = [
        (7, [{"scenes_id": 1, "scene_index": 0, "text": "a"}]),
        (8, [{"scenes_id": 2, "scene_index": 0, "text": "b"}]),
    ]
    reqs = batch.build_requests(movies)
    assert [r["custom_id"] for r in reqs] == ["7", "8"]
    p = reqs[0]["params"]
    assert p["model"] == "claude-sonnet-4-6"
    assert p["thinking"]["type"] == "disabled"
    assert p["output_config"]["format"]["type"] == "json_schema"
    assert "scenes" in p["output_config"]["format"]["schema"]["properties"]


def test_submit_returns_id_and_prints(capsys):
    captured = {}

    class Batches:
        def create(self, requests):
            captured["n"] = len(requests)
            return types.SimpleNamespace(id="batch_abc")

    client = types.SimpleNamespace(messages=types.SimpleNamespace(batches=Batches()))
    assert batch.submit(client, [{"custom_id": "1", "params": {}}]) == "batch_abc"
    assert captured["n"] == 1
    assert "batch_abc" in capsys.readouterr().out


def test_poll_until_ended(monkeypatch):
    monkeypatch.setattr(batch.time, "sleep", lambda s: None)
    calls = {"n": 0}

    class Batches:
        def retrieve(self, bid):
            calls["n"] += 1
            status = "in_progress" if calls["n"] < 2 else "ended"
            return types.SimpleNamespace(processing_status=status)

    client = types.SimpleNamespace(messages=types.SimpleNamespace(batches=Batches()))
    batch.poll(client, "batch_abc", interval=0)
    assert calls["n"] == 2


def _result(custom_id, rtype, text=None):
    if rtype == "succeeded":
        msg = types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=text)])
        res = types.SimpleNamespace(type="succeeded", message=msg)
    else:
        res = types.SimpleNamespace(type=rtype)
    return types.SimpleNamespace(custom_id=custom_id, result=res)


def test_collect_parses_and_flags():
    results = [
        _result("7", "succeeded", '{"scenes":[{"scene_index":0,"arousal":0.8,"valence":0.2}]}'),
        _result("8", "errored"),
        _result("9", "succeeded", "not-json"),
    ]

    class Batches:
        def results(self, bid):
            return iter(results)

    client = types.SimpleNamespace(messages=types.SimpleNamespace(batches=Batches()))
    out = list(batch.collect(client, "batch_abc"))
    assert out[0] == (7, {"scenes": [{"scene_index": 0, "arousal": 0.8, "valence": 0.2}]}, None)
    assert out[1][0] == 8 and out[1][1] is None and "errored" in out[1][2]
    assert out[2][0] == 9 and out[2][1] is None and "parse" in out[2][2].lower()
