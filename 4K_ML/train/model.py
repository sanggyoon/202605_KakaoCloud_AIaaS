"""하이브리드 RoBERTa 회귀: 텍스트(CLS) ⊕ 숫자피처 → MLP → sigmoid 2-출력."""
import torch
import torch.nn as nn


class HybridRobertaRegressor(nn.Module):
    def __init__(self, encoder, num_numeric: int = 5, hidden: int = 256, dropout: float = 0.1):
        super().__init__()
        self.encoder = encoder
        dim = encoder.config.hidden_size
        self.head = nn.Sequential(
            nn.Linear(dim + num_numeric, hidden),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden, 2),
            nn.Sigmoid(),
        )

    def forward(self, input_ids, attention_mask, numeric):
        out = self.encoder(input_ids=input_ids, attention_mask=attention_mask)
        cls = out.last_hidden_state[:, 0]          # <s> 토큰
        h = torch.cat([cls, numeric], dim=1)
        return self.head(h)


def build_encoder(name: str = "roberta-base"):
    from transformers import RobertaModel
    return RobertaModel.from_pretrained(name)
