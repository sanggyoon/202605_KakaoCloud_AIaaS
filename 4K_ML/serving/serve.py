"""커스텀 predictor 컨테이너 진입점 — uvicorn으로 FastAPI 앱 서빙(:8080)."""
import uvicorn

from serving.predictor import app

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080)
