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


class SeqRobertaRegressor(nn.Module):
    """동결 RoBERTa 임베딩 ⊕ 숫자피처 → BiLSTM → 씬별 sigmoid 2출력 (문맥 인지)."""

    def __init__(self, encoder, num_numeric: int = 5, proj: int = 256,
                 lstm_hidden: int = 256, lstm_layers: int = 2, dropout: float = 0.2):
        super().__init__()
        self.encoder = encoder
        for p in self.encoder.parameters():
            p.requires_grad = False
        enc_dim = encoder.config.hidden_size
        self.proj = nn.Linear(enc_dim + num_numeric, proj)
        self.lstm = nn.LSTM(proj, lstm_hidden, num_layers=lstm_layers, batch_first=True,
                            bidirectional=True, dropout=dropout if lstm_layers > 1 else 0.0)
        self.head = nn.Sequential(nn.Dropout(dropout), nn.Linear(lstm_hidden * 2, 2), nn.Sigmoid())

    def embed_scenes(self, input_ids, attention_mask):
        """(N, L) 토큰 → (N, enc_dim) CLS 임베딩. 인코더 동결이라 grad 없음."""
        self.encoder.eval()
        with torch.no_grad():
            out = self.encoder(input_ids=input_ids, attention_mask=attention_mask)
        return out.last_hidden_state[:, 0]

    def seq_forward(self, embs, numeric, lengths):
        """embs (B,T,enc_dim), numeric (B,T,num_numeric), lengths (B,) → (B,T,2)."""
        x = torch.relu(self.proj(torch.cat([embs, numeric], dim=-1)))
        packed = nn.utils.rnn.pack_padded_sequence(
            x, lengths.cpu(), batch_first=True, enforce_sorted=False)
        out, _ = self.lstm(packed)
        out, _ = nn.utils.rnn.pad_packed_sequence(
            out, batch_first=True, total_length=embs.size(1))
        return self.head(out)

    def head_parameters(self):
        """학습 대상(인코더 제외): 사영·LSTM·출력 헤드."""
        for module in (self.proj, self.lstm, self.head):
            yield from module.parameters()
