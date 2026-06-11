"""매니저 수동 수집용 인메모리 잡 레지스트리 (타입별 활성 잡 1건).

수집 데이터는 DB에 즉시 커밋되므로 이 레지스트리는 표시용 상태만 보관한다.
factory(client) -> 이벤트 async iterator (progress/done) 를 받아 백그라운드 소비한다.
"""
import asyncio
from datetime import datetime, timezone

import httpx

LOG_CAP = 500

_REGISTRY: dict[str, dict] = {}
_TASKS: dict[str, asyncio.Task] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _idle() -> dict:
    return {"state": "idle", "processed": 0, "target": 0, "added": 0,
            "skipped": 0, "failed": [], "log": [], "error": None,
            "started_at": None, "finished_at": None}


def get(job_type: str) -> dict:
    return _REGISTRY.get(job_type) or _idle()


def _log_line(ev: dict) -> str:
    parts = [f"[{ev.get('processed')}] {ev.get('result', 'processed')}",
             f"tmdb={ev.get('tmdb_id')}"]
    if ev.get("title"):
        parts.append(str(ev["title"]))
    if ev.get("error"):
        parts.append(f"— {ev['error']}")
    return " ".join(parts)


async def _run(job_type: str, factory) -> None:
    st = _REGISTRY[job_type]
    try:
        async with httpx.AsyncClient(timeout=60, verify=False) as client:
            async for ev in factory(client):
                if ev.get("type") == "progress":
                    st["processed"] = ev.get("processed", st["processed"])
                    st["target"] = ev.get("target", st["target"])
                    st["log"].append(_log_line(ev))
                    del st["log"][:-LOG_CAP]
                elif ev.get("type") == "done":
                    st["added"] = ev.get("added", 0)
                    st["skipped"] = ev.get("skipped", 0)
                    st["failed"] = ev.get("failed", [])
        st["state"] = "done"
    except Exception as e:  # noqa: BLE001
        st["state"] = "failed"
        st["error"] = str(e)[:500]
    finally:
        st["finished_at"] = _now()


def start(job_type: str, factory) -> dict:
    cur = _REGISTRY.get(job_type)
    if cur and cur["state"] == "running":
        return cur
    st = _idle()
    st["state"] = "running"
    st["started_at"] = _now()
    _REGISTRY[job_type] = st
    _TASKS[job_type] = asyncio.create_task(_run(job_type, factory))
    return st
