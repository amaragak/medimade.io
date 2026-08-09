#!/usr/bin/env python3
"""GPU sanity check: load models, synthesize a short clip, write test_output.wav."""

from __future__ import annotations

import os

# Local cache under this directory (gitignored). Docker sets HF_HOME=/models in the image.
os.environ.setdefault("HF_HOME", os.path.join(os.path.dirname(__file__), ".cache"))
# Allow HuggingFace download on first local run (Docker sets HF_LOCAL_FILES_ONLY=1).
os.environ.setdefault("HF_LOCAL_FILES_ONLY", "0")
if not os.environ.get("HF_TOKEN", "").strip():
    print(
        "Note: HF_TOKEN may be required — accept access at "
        "https://huggingface.co/canopylabs/orpheus-3b-0.1-ft then "
        "export HF_TOKEN=hf_...",
        flush=True,
    )

import base64
import sys

from handler import handler


def main() -> int:
    job = {
        "input": {
            "text": "Welcome. <sigh> Let your shoulders drop.",
            "voice": "tara",
        }
    }
    print("Running handler locally…")
    result = handler(job)

    if not isinstance(result, dict):
        print(f"ERROR: handler returned {type(result)!r}, expected dict")
        return 1

    if "error" in result:
        print(f"ERROR: {result['error']}")
        return 1

    audio_b64 = result.get("audio_base64")
    if not isinstance(audio_b64, str) or not audio_b64.strip():
        print("ERROR: missing audio_base64 in handler output")
        return 1

    wav_bytes = base64.b64decode(audio_b64)
    out_path = "test_output.wav"
    with open(out_path, "wb") as f:
        f.write(wav_bytes)

    print(f"Wrote {out_path} ({len(wav_bytes)} bytes)")
    for key in (
        "format",
        "sample_rate",
        "duration_seconds",
        "voice",
        "chunks",
        "generation_seconds",
    ):
        print(f"  {key}: {result.get(key)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
