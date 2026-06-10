"""all-MiniLM-L6-v2 임베딩. 모델은 최초 호출 시 lazy 로드(테스트에선 호출 안 함)."""
import numpy as np

_MODEL = None


def _get_model():
    global _MODEL
    if _MODEL is None:
        from sentence_transformers import SentenceTransformer
        _MODEL = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
    return _MODEL


def embed_texts(texts: list[str]) -> np.ndarray:
    if not texts:
        return np.zeros((0, 384))
    return _get_model().encode(texts, batch_size=64, show_progress_bar=False,
                               convert_to_numpy=True)
