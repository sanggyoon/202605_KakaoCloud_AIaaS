"""KServe 커스텀 predictor — predict_core를 kserve.Model로 감싼다."""
import os

import kserve

from serving.predict_core import load_artifacts, score_instances


class VAPredictor(kserve.Model):
    def __init__(self, name: str):
        super().__init__(name)
        self.name = name
        self.ready = False
        self.model = None
        self.scaler = None
        self.tokenizer = None
        self.max_len = 512
        self.model_version = "roberta-va-v1"

    def load(self):
        model_dir = os.getenv("MODEL_DIR", "/mnt/models")
        self.model, self.scaler, self.tokenizer, cfg = load_artifacts(model_dir)
        self.max_len = int(cfg.get("max_len", 512))
        self.model_version = cfg.get("model_version", "roberta-va-v1")
        self.ready = True

    def predict(self, payload, headers=None):
        instances = payload.get("instances", []) if isinstance(payload, dict) else []
        preds = score_instances(self.model, self.scaler, self.tokenizer, self.max_len, instances)
        return {"predictions": preds, "model_version": self.model_version}
