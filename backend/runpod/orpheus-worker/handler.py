"""
RunPod Serverless worker for Orpheus TTS (3B, vLLM).

Input (event["input"]):
  - text: str — text to synthesize
  - voice: str — Orpheus voice id (default: "tara")

Output:
  - audio_base64: WAV mono 24 kHz 16-bit PCM, base64-encoded
"""

from __future__ import annotations

import base64
import io
import wave

import runpod
from orpheus_tts import OrpheusModel

# Load once per worker process (cold start); reused across jobs.
model = OrpheusModel(
    model_name="canopylabs/orpheus-tts-0.1-finetune-prod",
    max_model_len=2048,
)


def handler(event: dict) -> dict:
    inp = event.get("input") or {}
    if not isinstance(inp, dict):
        return {"error": "`input` must be an object"}

    text = inp.get("text", "")
    if not isinstance(text, str):
        return {"error": "`input.text` must be a string"}
    text = text.strip()
    if not text:
        return {"error": "`input.text` is required"}

    voice = inp.get("voice", "tara")
    if not isinstance(voice, str) or not voice.strip():
        voice = "tara"
    voice = voice.strip()

    try:
        syn_tokens = model.generate_speech(prompt=text, voice=voice)
    except Exception as e:
        return {"error": f"generate_speech failed: {e}"}

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(24000)
        for chunk in syn_tokens:
            wf.writeframes(chunk)

    audio_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    return {"audio_base64": audio_b64}


runpod.serverless.start({"handler": handler})
