import pytest

from app import jobs


@pytest.fixture(autouse=True)
def _clear():
    jobs._REGISTRY.clear()
    jobs._TASKS.clear()
    yield
    jobs._REGISTRY.clear()
    jobs._TASKS.clear()


async def _fake_ok(client):
    yield {"type": "progress", "processed": 1, "target": 2, "tmdb_id": 10,
           "title": "A", "result": "added", "error": None}
    yield {"type": "progress", "processed": 2, "target": 2, "tmdb_id": 11,
           "title": None, "result": "skipped", "error": None}
    yield {"type": "done", "added": 1, "skipped": 1, "failed": []}


async def _fake_boom(client):
    raise RuntimeError("kaboom")
    yield  # async generator로 만들기 위함(도달 안 함)


def test_get_defaults_idle():
    assert jobs.get("movie")["state"] == "idle"


async def test_start_runs_and_records():
    st = jobs.start("movie", _fake_ok)
    assert st["state"] == "running"
    await jobs._TASKS["movie"]
    final = jobs.get("movie")
    assert final["state"] == "done"
    assert final["processed"] == 2 and final["target"] == 2
    assert final["added"] == 1 and final["skipped"] == 1
    assert len(final["log"]) == 2


async def test_start_dedupes_running():
    jobs._REGISTRY["movie"] = {**jobs._idle(), "state": "running"}
    st = jobs.start("movie", _fake_ok)
    assert st["state"] == "running"
    assert "movie" not in jobs._TASKS  # 새 태스크 생성 안 함


async def test_run_captures_exception():
    jobs._REGISTRY["subtitle"] = {**jobs._idle(), "state": "running", "started_at": jobs._now()}
    await jobs._run("subtitle", _fake_boom)
    st = jobs.get("subtitle")
    assert st["state"] == "failed"
    assert "kaboom" in st["error"]
