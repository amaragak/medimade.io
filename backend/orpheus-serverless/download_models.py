#!/usr/bin/env python3
"""Bake HuggingFace weights into the Docker image at build time."""

from __future__ import annotations

import os
import sys
import time

ORPHEUS_MODEL_ID = "canopylabs/orpheus-3b-0.1-ft"
SNAC_MODEL_ID = "hubertsiuzdak/snac_24khz"
CACHE_DIR = os.environ.get("HF_HOME", "/models")


def require_hf_token() -> str:
    token = os.environ.get("HF_TOKEN", "").strip()
    if token:
        return token
    print(
        "ERROR: HF_TOKEN is required to download the gated Orpheus model.\n"
        "  1. Open https://huggingface.co/canopylabs/orpheus-3b-0.1-ft and accept access\n"
        "  2. Create a read token at https://huggingface.co/settings/tokens\n"
        "  3. Pass it as HF_TOKEN (GitHub secret HF_TOKEN for Actions builds)",
        flush=True,
    )
    sys.exit(1)


def main() -> None:
    from huggingface_hub import snapshot_download

    token = require_hf_token()
    os.makedirs(CACHE_DIR, exist_ok=True)

    print(f"Downloading Orpheus 3B weights ({ORPHEUS_MODEL_ID})…", flush=True)
    t0 = time.perf_counter()
    try:
        snapshot_download(
            ORPHEUS_MODEL_ID,
            cache_dir=CACHE_DIR,
            token=token,
            ignore_patterns=["*.pth", "*.bin"],
        )
    except Exception as exc:
        print(f"ERROR: Orpheus download failed: {exc}", flush=True)
        print(
            "If this mentions access/authentication, accept the model terms on HuggingFace "
            "and ensure HF_TOKEN belongs to an account with access.",
            flush=True,
        )
        raise
    print(
        f"Orpheus weights cached in {time.perf_counter() - t0:.1f}s",
        flush=True,
    )

    print(f"Downloading SNAC decoder ({SNAC_MODEL_ID})…", flush=True)
    t1 = time.perf_counter()
    snapshot_download(SNAC_MODEL_ID, cache_dir=CACHE_DIR, token=token)
    print(
        f"SNAC weights cached in {time.perf_counter() - t1:.1f}s",
        flush=True,
    )


if __name__ == "__main__":
    main()
