# RunPod Serverless worker — Orpheus TTS 3B (vLLM).
# Build: ../../scripts/build-runpod-orpheus [--push IMAGE]
FROM runpod/base:0.6.2-cuda12.1.0

RUN pip install --no-cache-dir orpheus-speech runpod && \
    pip install --no-cache-dir vllm==0.7.3

COPY handler.py /handler.py

CMD ["python3", "-u", "/handler.py"]
