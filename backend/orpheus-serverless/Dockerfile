# Orpheus 3B TTS — RunPod Serverless worker
#
# Build context: run all docker commands from this directory
# (backend/orpheus-serverless/).
#
# Build requires HF_TOKEN — canopylabs/orpheus-3b-0.1-ft is gated on HuggingFace.
# Accept access at https://huggingface.co/canopylabs/orpheus-3b-0.1-ft first.

FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV HF_HOME=/models
ENV PYTHONUNBUFFERED=1

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

# Bake HuggingFace weights into the image (~15–18GB total).
# HF_TOKEN is passed as a BuildKit secret so it is not stored in image layers.
RUN --mount=type=secret,id=hf_token \
    HF_TOKEN="$(cat /run/secrets/hf_token)" \
    python3 download_models.py

# Runtime: only use baked weights, never re-download on cold start.
ENV HF_LOCAL_FILES_ONLY=1

COPY handler.py .

CMD ["python", "-u", "handler.py"]
