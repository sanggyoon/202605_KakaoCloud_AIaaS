# CUDA+torch 내장 베이스 (T4 / driver 580 호환). torch는 베이스에 포함.
FROM pytorch/pytorch:2.5.1-cuda12.1-cudnn9-runtime

WORKDIR /app

# 의존성 — torch는 베이스에 이미 있어 재설치되지 않음(요구버전 충족)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# all-MiniLM 모델을 이미지에 굽기 (런타임 HuggingFace 다운로드 제거).
# HF가 CI 공용 IP에 429를 주는 경우가 있어: (1) HF_TOKEN 시크릿이 있으면 인증, (2) 재시도.
RUN --mount=type=secret,id=hf_token \
    sh -c 'if [ -s /run/secrets/hf_token ]; then export HF_TOKEN="$(cat /run/secrets/hf_token)"; fi; \
    for i in 1 2 3 4 5; do \
      python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer(\"sentence-transformers/all-MiniLM-L6-v2\")" && exit 0; \
      echo "HF 다운로드 재시도 $i/5 — 20초 대기"; sleep 20; \
    done; \
    echo "HF 모델 다운로드 5회 실패"; exit 1'

# roberta-base도 이미지에 굽기 (학습 시 런타임 HF 다운로드 제거).
RUN --mount=type=secret,id=hf_token \
    sh -c 'if [ -s /run/secrets/hf_token ]; then export HF_TOKEN="$(cat /run/secrets/hf_token)"; fi; \
    for i in 1 2 3 4 5; do \
      python -c "from transformers import RobertaModel, RobertaTokenizerFast; RobertaModel.from_pretrained(\"roberta-base\"); RobertaTokenizerFast.from_pretrained(\"roberta-base\")" && exit 0; \
      echo "HF roberta 재시도 $i/5 — 20초 대기"; sleep 20; \
    done; \
    echo "roberta-base 다운로드 5회 실패"; exit 1'

# 코드 (ML 변환 모듈)
COPY subtitle_parse/ ./subtitle_parse/
COPY labeling/ ./labeling/
COPY train/ ./train/
COPY serving/ ./serving/
COPY generate_vectors/ ./generate_vectors/

# ENTRYPOINT 없음 — WorkflowTemplate가 `python -m <module>` 지정
