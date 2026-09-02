# Fastembed Lambda layer (Python 3.12)
#
# Contents:
# - fastembed + onnxruntime (CPU) + deps under python/lib/python3.12/site-packages/
# - BAAI/bge-small-en-v1.5 ONNX (qdrant quantized) under python/model_cache/
#
# Rebuild:
#   cd backend && ./scripts/build-fastembed-layer
# Then commit `layers/fastembed/python/` (same pattern as Pedalboard).
#
# Target: under the 250MB unzipped Lambda layer limit (~100–230MB depending on prune).
# Note: Pillow must remain in the layer — fastembed.common.types imports PIL at import time.
