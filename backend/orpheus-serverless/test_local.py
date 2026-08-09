#!/usr/bin/env python3
"""GPU sanity check: load models, synthesize a short clip, write test_output.wav."""

from __future__ import annotations

import os

os.environ.setdefault("HF_HOME", os.path.join(os.path.dirname(__file__), ".cache"))
os.environ.setdefault("HF_LOCAL_FILES_ONLY", "0")
os.environ.setdefault("ORPHEUS_MODEL_PATH", os.path.join(os.path.dirname(__file__), ".cache", "orpheus-3b"))
os.environ.setdefault("SNAC_MODEL_PATH", os.path.join(os.path.dirname(__file__), ".cache", "snac"))

if not os.environ.get("HF_TOKEN", "").strip():
    print(
        "Note: HF_TOKEN may be required — accept access at "
        "https://huggingface.co/canopylabs/orpheus-3b-0.1-ft then "
        "export HF_TOKEN=hf_...",
        flush=True,
    )

import base64
import sys

from handler import handler, load_models


def main() -> int:
    print("Loading models (local GPU test)…", flush=True)
    try:
        load_models()
    except Exception as exc:
        print(f"ERROR: model load failed: {exc}", flush=True)
        return 1

    job = {
        "input": {
            "text": "Welcome. <sigh> Let your shoulders drop.",
            "voice": "tara",
        }
    }
    print("Running handler…", flush=True)
    result = handler(job)

    if not isinstance(result, dict):
        print(f"ERROR: handler returned {type(result)!r}", flush=True)
        return 1
    if "error" in result:
        print(f"ERROR: {result['error']}", flush=True)
        return 1

    audio_b64 = result.get("audio_base64")
    if not isinstance(audio_b64, str) or not audio_b64.strip():
        print("ERROR: missing audio_base64", flush=True)
        return 1

    wav_bytes = base64.b64decode(audio_b64)
    out_path = "test_output.wav"
    with open(out_path, "wb") as f:
        f.write(wav_bytes)

    print(f"Wrote {out_path} ({len(wav_bytes)} bytes)", flush=True)
    for key in (
        "format",
        "sample_rate",
        "duration_seconds",
        "voice",
        "chunks",
        "generation_seconds",
    ):
        print(f"  {key}: {result.get(key)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
