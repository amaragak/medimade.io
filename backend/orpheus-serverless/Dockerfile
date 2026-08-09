# Orpheus 3B TTS — RunPod Serverless worker
#
# Build context: run all docker commands from this directory
# (backend/orpheus-serverless/).

FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV HF_HOME=/models
ENV PYTHONUNBUFFERED=1
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

# Bake HuggingFace weights into the image (~15–18GB total).
# Without this, every cold start downloads ~6GB while billing GPU time.
RUN python3 - <<'PY'
import time
from huggingface_hub import snapshot_download

print("Downloading Orpheus 3B weights…", flush=True)
t0 = time.perf_counter()
snapshot_download(
    "canopylabs/orpheus-3b-0.1-ft",
    cache_dir="/models",
    ignore_patterns=["*.pth", "*.bin"],
)
print(f"Orpheus weights cached in {time.perf_counter() - t0:.1f}s", flush=True)

print("Downloading SNAC decoder weights…", flush=True)
t1 = time.perf_counter()
snapshot_download(
    "hubertsiuzdak/snac_24khz",
    cache_dir="/models",
)
print(f"SNAC weights cached in {time.perf_counter() - t1:.1f}s", flush=True)
PY

COPY handler.py .

CMD ["python", "-u", "handler.py"]
