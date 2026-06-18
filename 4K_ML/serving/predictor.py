"""KServe(RawDeployment) 커스텀 컨테이너 — FastAPI로 V1 추론 프로토콜 구현.

kserve SDK는 numpy<2·httpx<0.27을 강제해 우리 ML 스택(numpy 2·scipy 1.17·transformers)과
충돌하므로, KServe 프로토콜(`/v1/models/{name}`, `:predict`)을 FastAPI로 직접 구현한다.
KServe 커스텀 predictor는 이 프로토콜을 8080에서 서빙하는 컨테이너면 충분하다.
"""
import os

from fastapi import FastAPI
from pydantic import BaseModel

from serving.predict_core import load_artifacts, score_instances, score_instances_seq

MODEL_NAME = "roberta-va"


class PredictRequest(BaseModel):
    instances: list[dict]


def create_app(loader=load_artifacts) -> FastAPI:
    app = FastAPI()
    state: dict = {"ready": False}

    @app.on_event("startup")
    def _load():
        model_dir = os.getenv("MODEL_DIR", "/mnt/models")
        model, scaler, tok, cfg = loader(model_dir)
        scorer = score_instances_seq if cfg.get("model_kind") == "seq" else score_instances
        state.update({
            "model": model, "scaler": scaler, "tok": tok,
            "max_len": int(cfg.get("max_len", 512)),
            "model_version": cfg.get("model_version", "roberta-va-v1"),
            "scorer": scorer,
            "ready": True,
        })

    @app.get("/v1/models/" + MODEL_NAME)
    def ready():
        return {"name": MODEL_NAME, "ready": state.get("ready", False)}

    @app.post("/v1/models/" + MODEL_NAME + ":predict")
    def predict(req: PredictRequest):
        preds = state["scorer"](state["model"], state["scaler"], state["tok"],
                                state["max_len"], req.instances)
        return {"predictions": preds, "model_version": state["model_version"]}

    return app


app = create_app()
