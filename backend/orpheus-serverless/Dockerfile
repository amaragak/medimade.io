# Orpheus 3B TTS — RunPod Serverless worker
#
# Build requires HF_TOKEN — canopylabs/orpheus-3b-0.1-ft is gated on HuggingFace.

FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV ORPHEUS_MODEL_PATH=/models/orpheus-3b
ENV SNAC_MODEL_PATH=/models/snac
ENV HF_LOCAL_FILES_ONLY=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 \
    python3.10-venv \
    python3-pip \
    git \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.10 /usr/bin/python3 \
    && ln -sf /usr/bin/python3.10 /usr/bin/python

WORKDIR /app

COPY requirements.txt .
RUN pip3 install --no-cache-dir --upgrade pip \
    && pip3 install --no-cache-dir -r requirements.txt

COPY download_models.py .

RUN --mount=type=secret,id=hf_token \
    HF_TOKEN="$(cat /run/secrets/hf_token)" \
    python3 download_models.py

COPY handler.py .

CMD ["python3", "-u", "handler.py"]
