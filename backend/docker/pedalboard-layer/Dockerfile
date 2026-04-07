# Build Pedalboard + native deps for AWS Lambda Python 3.12 (Amazon Linux 2023, x86_64).
# Run via ../scripts/build-pedalboard-layer.sh — do not deploy this image; only copy /asset out.
FROM --platform=linux/amd64 public.ecr.aws/lambda/python:3.12

COPY requirements.txt /tmp/requirements.txt

RUN mkdir -p /asset/python/lib/python3.12/site-packages && \
    pip install --no-cache-dir -r /tmp/requirements.txt \
      -t /asset/python/lib/python3.12/site-packages

# Prune caches for a smaller layer
RUN find /asset -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true && \
    find /asset -name '*.pyc' -delete 2>/dev/null || true
