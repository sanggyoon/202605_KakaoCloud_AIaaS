"""동결 인코더로 씬 텍스트 → CLS 임베딩 사전계산 (학습 가속용)."""
import numpy as np
import torch


def compute_embeddings(model, tok, texts, device, max_len: int = 512,
                       batch_size: int = 32) -> np.ndarray:
    """texts(list[str]) → (N, enc_dim) CLS 임베딩. 동결 인코더라 grad 없음."""
    if not texts:
        return np.zeros((0, model.encoder.config.hidden_size), dtype=np.float32)
    model.eval()
    chunks = []
    for i in range(0, len(texts), batch_size):
        part = [t or "" for t in texts[i:i + batch_size]]
        enc = tok(part, truncation=True, max_length=max_len, padding="max_length",
                  return_tensors="pt")
        e = model.embed_scenes(enc["input_ids"].to(device), enc["attention_mask"].to(device))
        chunks.append(e.cpu().numpy())
    return np.concatenate(chunks).astype(np.float32)
