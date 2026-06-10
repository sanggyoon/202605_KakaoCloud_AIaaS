"""Anthropic Batch API 래퍼 — 영화별 요청 빌드/제출/폴링/결과수집."""
import json
import time

from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
from anthropic.types.messages.batch_create_params import Request

from labeling.prompt import RUBRIC, OUTPUT_SCHEMA, build_user_message

MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 8000


def build_requests(movies: list[tuple[int, list[dict]]]) -> list[Request]:
    """[(tmdb_id, scenes)] → 영화당 Batch Request 1개."""
    reqs: list[Request] = []
    for tmdb_id, scenes in movies:
        reqs.append(Request(
            custom_id=str(tmdb_id),
            params=MessageCreateParamsNonStreaming(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                thinking={"type": "disabled"},
                system=[{"type": "text", "text": RUBRIC,
                         "cache_control": {"type": "ephemeral"}}],
                output_config={"format": {"type": "json_schema", "schema": OUTPUT_SCHEMA}},
                messages=[{"role": "user", "content": build_user_message(scenes)}],
            ),
        ))
    return reqs


def submit(client, requests) -> str:
    batch = client.messages.batches.create(requests=requests)
    print(f"[batch] submitted id={batch.id} count={len(requests)}")
    return batch.id


def poll(client, batch_id: str, interval: int = 60) -> None:
    while True:
        b = client.messages.batches.retrieve(batch_id)
        if b.processing_status == "ended":
            return
        time.sleep(interval)


def collect(client, batch_id: str):
    """결과 스트림 → (tmdb_id, parsed|None, error|None)."""
    for result in client.messages.batches.results(batch_id):
        tmdb_id = int(result.custom_id)
        if result.result.type == "succeeded":
            try:
                text = next(b.text for b in result.result.message.content if b.type == "text")
                yield tmdb_id, json.loads(text), None
            except (StopIteration, json.JSONDecodeError) as e:
                yield tmdb_id, None, f"parse error: {e}"
        else:
            yield tmdb_id, None, f"batch result {result.result.type}"
