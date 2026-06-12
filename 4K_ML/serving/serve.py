"""KServe ModelServer 진입점 — `python -m serving.serve`."""
import kserve

from serving.predictor import VAPredictor

if __name__ == "__main__":
    model = VAPredictor("roberta-va")
    model.load()
    kserve.ModelServer().start([model])
