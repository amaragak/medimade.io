# Build fastembed + ONNX Runtime for AWS Lambda Python 3.12 (Amazon Linux, x86_64).
# Prefer: ../scripts/build-fastembed-layer (Docker). Do not deploy this image; copy /asset out.
FROM --platform=linux/amd64 public.ecr.aws/lambda/python:3.12

COPY requirements.txt /tmp/requirements.txt

RUN mkdir -p /asset/python/lib/python3.12/site-packages /asset/python/model_cache && \
    pip install --no-cache-dir -r /tmp/requirements.txt \
      -t /asset/python/lib/python3.12/site-packages && \
    FASTEMBED_CACHE_PATH=/asset/python/model_cache python -c \
      "import os; os.environ['FASTEMBED_CACHE_PATH']='/asset/python/model_cache'; \
       from fastembed import TextEmbedding; \
       list(TextEmbedding(model_name='BAAI/bge-small-en-v1.5').embed(['warmup']))" && \
    find /asset -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true && \
    find /asset -type d \( -name tests -o -name test \) -exec rm -rf {} + 2>/dev/null || true && \
    find /asset -name '*.pyc' -delete 2>/dev/null || true && \
    rm -rf /asset/python/model_cache/.locks
