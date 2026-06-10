# CUDA+torch 내장 베이스 (T4 / driver 580 호환). torch는 베이스에 포함.
FROM pytorch/pytorch:2.5.1-cuda12.1-cudnn9-runtime

WORKDIR /app

# 의존성 — torch는 베이스에 이미 있어 재설치되지 않음(요구버전 충족)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# all-MiniLM 모델을 이미지에 굽기 (런타임 HuggingFace 다운로드 제거)
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')"

# 코드 (ML 변환 모듈)
COPY subtitle_parse/ ./subtitle_parse/
COPY db/ ./db/
COPY generate_vectors/ ./generate_vectors/

# ENTRYPOINT 없음 — WorkflowTemplate가 `python -m <module>` 지정
