#!/usr/bin/env python3
"""Bake HuggingFace weights into fixed paths in the Docker image at build time."""

from __future__ import annotations

import os
import sys
import time

ORPHEUS_MODEL_ID = "canopylabs/orpheus-3b-0.1-ft"
SNAC_MODEL_ID = "hubertsiuzdak/snac_24khz"
ORPHEUS_DIR = os.environ.get("ORPHEUS_MODEL_PATH", "/models/orpheus-3b")
SNAC_DIR = os.environ.get("SNAC_MODEL_PATH", "/models/snac")


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


def verify_model_dir(label: str, path: str, required_files: tuple[str, ...]) -> None:
    if not os.path.isdir(path):
        raise RuntimeError(f"{label}: directory missing: {path}")
    names = set(os.listdir(path))
    missing = [f for f in required_files if f not in names]
    if missing:
        raise RuntimeError(
            f"{label}: {path} missing {missing}; found {sorted(names)[:30]}",
        )
    print(f"Verified {label} at {path}: {sorted(names)[:12]}", flush=True)


def main() -> None:
    from huggingface_hub import snapshot_download

    token = require_hf_token()
    os.makedirs(os.path.dirname(ORPHEUS_DIR), exist_ok=True)

    print(f"Downloading Orpheus 3B → {ORPHEUS_DIR}", flush=True)
    t0 = time.perf_counter()
    try:
        snapshot_download(
            ORPHEUS_MODEL_ID,
            local_dir=ORPHEUS_DIR,
            token=token,
            ignore_patterns=["*.pth", "*.bin"],
        )
    except Exception as exc:
        print(f"ERROR: Orpheus download failed: {exc}", flush=True)
        raise
    print(f"Orpheus download done in {time.perf_counter() - t0:.1f}s", flush=True)
    verify_model_dir("Orpheus", ORPHEUS_DIR, ("config.json",))

    print(f"Downloading SNAC → {SNAC_DIR}", flush=True)
    t1 = time.perf_counter()
    snapshot_download(SNAC_MODEL_ID, local_dir=SNAC_DIR, token=token)
    print(f"SNAC download done in {time.perf_counter() - t1:.1f}s", flush=True)
    verify_model_dir("SNAC", SNAC_DIR, ("config.json",))

    print("Model bake complete.", flush=True)


if __name__ == "__main__":
    main()
