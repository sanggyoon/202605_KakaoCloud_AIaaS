import torch
from transformers import RobertaConfig, RobertaModel

from train.model import HybridRobertaRegressor


def _tiny_encoder():
    cfg = RobertaConfig(vocab_size=50265, hidden_size=32, num_hidden_layers=2,
                        num_attention_heads=2, intermediate_size=64, max_position_embeddings=64)
    return RobertaModel(cfg)


def test_forward_shape_and_range():
    model = HybridRobertaRegressor(_tiny_encoder(), num_numeric=5, hidden=16)
    b = 3
    input_ids = torch.randint(0, 100, (b, 10))
    attn = torch.ones((b, 10), dtype=torch.long)
    numeric = torch.randn(b, 5)
    out = model(input_ids, attn, numeric)
    assert out.shape == (b, 2)
    assert float(out.min()) >= 0.0 and float(out.max()) <= 1.0  # sigmoid
