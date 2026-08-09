"""
RunPod Serverless worker for Orpheus 3B TTS.

Uses runpod.serverless.start() — NOT a FastAPI/Gradio HTTP server.
RunPod dispatches jobs through a queue; the handler loop polls for work.
"""

from __future__ import annotations

import base64
import io
import os
import re
import time
import traceback
import wave
from typing import Any

import numpy as np
import runpod
import torch
from snac import SNAC
from transformers import AutoModelForCausalLM, AutoTokenizer

# ---------------------------------------------------------------------------
# Orpheus token constants
# ---------------------------------------------------------------------------
TOKEN_START_HUMAN = 128259
TOKEN_END_TEXT = 128009
TOKEN_END_HUMAN = 128260
TOKEN_START_AUDIO = 128257
TOKEN_END_AUDIO = 128258
AUDIO_TOKEN_OFFSET = 128266
TOKENS_PER_SECOND = 86  # ~7 tokens/frame at ~12.5 frames/sec

SAMPLE_RATE = 24000
SILENCE_BETWEEN_CHUNKS_SEC = 0.3

VALID_VOICES = frozenset({"tara", "leah", "jess", "leo", "dan", "mia", "zac", "zoe"})
DEFAULT_VOICE = "tara"

ORPHEUS_MODEL_ID = "canopylabs/orpheus-3b-0.1-ft"
SNAC_MODEL_ID = "hubertsiuzdak/snac_24khz"
MODEL_CACHE_DIR = os.environ.get("HF_HOME", "/models")
# Docker builds bake weights into /models; local test sets HF_LOCAL_FILES_ONLY=0 to allow download.
LOCAL_FILES_ONLY = os.environ.get("HF_LOCAL_FILES_ONLY", "1") == "1"

# ---------------------------------------------------------------------------
# Cold-start model load (once per worker process)
# ---------------------------------------------------------------------------
print("[orpheus-serverless] Worker starting — loading models…", flush=True)

_device = "cuda" if torch.cuda.is_available() else "cpu"
if _device != "cuda":
    print(
        "[orpheus-serverless] WARNING: CUDA not available; inference will fail on GPU endpoints.",
        flush=True,
    )

_t0 = time.perf_counter()
print(f"[orpheus-serverless] Loading tokenizer: {ORPHEUS_MODEL_ID}", flush=True)
tokenizer = AutoTokenizer.from_pretrained(
    ORPHEUS_MODEL_ID,
    cache_dir=MODEL_CACHE_DIR,
    local_files_only=LOCAL_FILES_ONLY,
)
print(
    f"[orpheus-serverless] Tokenizer loaded in {time.perf_counter() - _t0:.1f}s",
    flush=True,
)

_t1 = time.perf_counter()
print(f"[orpheus-serverless] Loading Orpheus LM: {ORPHEUS_MODEL_ID}", flush=True)
orpheus_model = AutoModelForCausalLM.from_pretrained(
    ORPHEUS_MODEL_ID,
    cache_dir=MODEL_CACHE_DIR,
    local_files_only=LOCAL_FILES_ONLY,
    torch_dtype=torch.bfloat16,
    device_map="cuda" if _device == "cuda" else None,
)
if _device == "cuda":
    orpheus_model = orpheus_model.to("cuda")
orpheus_model.eval()
print(
    f"[orpheus-serverless] Orpheus LM loaded in {time.perf_counter() - _t1:.1f}s",
    flush=True,
)

_t2 = time.perf_counter()
print(f"[orpheus-serverless] Loading SNAC decoder: {SNAC_MODEL_ID}", flush=True)
snac_model = SNAC.from_pretrained(SNAC_MODEL_ID, cache_dir=MODEL_CACHE_DIR)
snac_model = snac_model.to(_device).eval()
print(
    f"[orpheus-serverless] SNAC loaded in {time.perf_counter() - _t2:.1f}s "
    f"(total cold start {time.perf_counter() - _t0:.1f}s)",
    flush=True,
)


def split_text_into_chunks(text: str, max_chunk_chars: int) -> list[str]:
    """Split at sentence boundaries, accumulating up to max_chunk_chars."""
    text = text.strip()
    if not text:
        return []
    if len(text) <= max_chunk_chars:
        return [text]

    sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks: list[str] = []
    current = ""

    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
        candidate = f"{current} {sentence}".strip() if current else sentence
        if len(candidate) <= max_chunk_chars:
            current = candidate
            continue
        if current:
            chunks.append(current)
        if len(sentence) <= max_chunk_chars:
            current = sentence
        else:
            for i in range(0, len(sentence), max_chunk_chars):
                chunks.append(sentence[i : i + max_chunk_chars])
            current = ""

    if current:
        chunks.append(current)
    return chunks if chunks else [text]


def build_prompt_ids(voice: str, text: str) -> torch.Tensor:
    prompt = f"{voice}: {text}"
    encoded = tokenizer(prompt, return_tensors="pt").input_ids
    device = next(orpheus_model.parameters()).device
    start = torch.tensor([[TOKEN_START_HUMAN]], device=device, dtype=encoded.dtype)
    end = torch.tensor(
        [[TOKEN_END_TEXT, TOKEN_END_HUMAN]],
        device=device,
        dtype=encoded.dtype,
    )
    encoded = encoded.to(device)
    return torch.cat([start, encoded, end], dim=1)


def extract_audio_codes(generated: torch.Tensor) -> list[int]:
    """Extract SNAC code indices from generated token sequence."""
    seq = generated[0].tolist() if generated.dim() > 1 else generated.tolist()

    last_start = -1
    for idx, token in enumerate(seq):
        if token == TOKEN_START_AUDIO:
            last_start = idx
    if last_start < 0:
        return []

    after_start = seq[last_start + 1 :]
    raw_tokens = [t for t in after_start if t != TOKEN_END_AUDIO]

    codes: list[int] = []
    for i, token in enumerate(raw_tokens):
        value = token - AUDIO_TOKEN_OFFSET - ((i % 7) * 4096)
        if value < 0 or value > 4095:
            break
        codes.append(value)

    trim = (len(codes) // 7) * 7
    return codes[:trim]


def redistribute_codes_to_layers(codes: list[int]) -> list[torch.Tensor]:
    """Map flat 7-token frames into SNAC's three codebook layers."""
    num_frames = len(codes) // 7
    layer_1: list[int] = []
    layer_2: list[int] = []
    layer_3: list[int] = []

    for frame_idx in range(num_frames):
        base = 7 * frame_idx
        layer_1.append(codes[base])
        layer_2.append(codes[base + 1])
        layer_2.append(codes[base + 4])
        layer_3.append(codes[base + 2])
        layer_3.append(codes[base + 3])
        layer_3.append(codes[base + 5])
        layer_3.append(codes[base + 6])

    device = next(snac_model.parameters()).device
    return [
        torch.tensor(layer_1, device=device, dtype=torch.int32).unsqueeze(0),
        torch.tensor(layer_2, device=device, dtype=torch.int32).unsqueeze(0),
        torch.tensor(layer_3, device=device, dtype=torch.int32).unsqueeze(0),
    ]


def decode_codes_to_waveform(codes: list[int]) -> np.ndarray:
    if len(codes) < 7:
        return np.array([], dtype=np.float32)

    code_tensors = redistribute_codes_to_layers(codes)
    with torch.inference_mode():
        audio_hat = snac_model.decode(code_tensors)

    audio = audio_hat.squeeze().detach().cpu().numpy().astype(np.float32)
    if audio.ndim > 1:
        audio = audio.reshape(-1)
    return audio


def generate_chunk_waveform(
    voice: str,
    text: str,
    *,
    temperature: float,
    top_p: float,
    repetition_penalty: float,
    max_seconds_per_chunk: float,
) -> np.ndarray:
    input_ids = build_prompt_ids(voice, text)
    max_new_tokens = min(
        int(max_seconds_per_chunk * TOKENS_PER_SECOND),
        8192,
    )
    rep_penalty = max(repetition_penalty, 1.1)

    with torch.inference_mode():
        generated = orpheus_model.generate(
            input_ids=input_ids,
            max_new_tokens=max_new_tokens,
            do_sample=True,
            temperature=temperature,
            top_p=top_p,
            repetition_penalty=rep_penalty,
            eos_token_id=TOKEN_END_AUDIO,
        )

    codes = extract_audio_codes(generated)
    return decode_codes_to_waveform(codes)


def concatenate_with_silence(segments: list[np.ndarray]) -> np.ndarray:
    if not segments:
        return np.array([], dtype=np.float32)
    silence = np.zeros(
        int(SILENCE_BETWEEN_CHUNKS_SEC * SAMPLE_RATE),
        dtype=np.float32,
    )
    parts: list[np.ndarray] = []
    for i, seg in enumerate(segments):
        if seg.size == 0:
            continue
        if parts:
            parts.append(silence)
        parts.append(seg.astype(np.float32, copy=False))
    if not parts:
        return np.array([], dtype=np.float32)
    return np.concatenate(parts)


def waveform_to_wav_bytes(audio: np.ndarray) -> bytes:
    clipped = np.clip(audio, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(pcm.tobytes())
    return buf.getvalue()


def handler(job: dict[str, Any]) -> dict[str, Any]:
    try:
        inp = job.get("input") or {}
        if not isinstance(inp, dict):
            return {"error": "`input` must be an object"}

        # Medimade backend sends OpenAI-shaped `input.input`; direct calls use `text`.
        text_raw = inp.get("text")
        if text_raw is None:
            text_raw = inp.get("input")
        text = text_raw if isinstance(text_raw, str) else ""
        if text_raw is not None and not isinstance(text_raw, str):
            return {"error": "`input.text` (or `input.input`) must be a string"}
        text = text.strip()
        if not text:
            return {"error": "`input.text` is required and must be non-empty"}

        voice = inp.get("voice", DEFAULT_VOICE)
        if not isinstance(voice, str) or not voice.strip():
            voice = DEFAULT_VOICE
        voice = voice.strip().lower()
        if voice not in VALID_VOICES:
            valid = ", ".join(sorted(VALID_VOICES))
            return {"error": f"Unknown voice {voice!r}. Valid voices: {valid}"}

        temperature = float(inp.get("temperature", 0.6))
        top_p = float(inp.get("top_p", 0.95))
        repetition_penalty = float(inp.get("repetition_penalty", 1.1))
        max_chunk_chars = int(inp.get("max_chunk_chars", 350))
        max_seconds_per_chunk = float(inp.get("max_seconds_per_chunk", 45))

        chunks = split_text_into_chunks(text, max_chunk_chars)
        if not chunks:
            return {"error": "No text chunks to synthesize"}

        gen_started = time.perf_counter()
        wave_segments: list[np.ndarray] = []

        for chunk_idx, chunk_text in enumerate(chunks, start=1):
            chunk_started = time.perf_counter()
            waveform = generate_chunk_waveform(
                voice,
                chunk_text,
                temperature=temperature,
                top_p=top_p,
                repetition_penalty=repetition_penalty,
                max_seconds_per_chunk=max_seconds_per_chunk,
            )
            chunk_seconds = waveform.size / SAMPLE_RATE if waveform.size else 0.0
            chunk_elapsed = time.perf_counter() - chunk_started
            print(
                f"[orpheus-serverless] chunk {chunk_idx}/{len(chunks)}: "
                f"{chunk_seconds:.2f}s audio in {chunk_elapsed:.2f}s "
                f"({len(chunk_text)} chars)",
                flush=True,
            )
            if waveform.size == 0:
                return {
                    "error": f"Chunk {chunk_idx} produced no audio (generation may have failed)",
                }
            wave_segments.append(waveform)

        full_audio = concatenate_with_silence(wave_segments)
        if full_audio.size == 0:
            return {"error": "Synthesis produced no audio"}

        generation_seconds = time.perf_counter() - gen_started
        duration_seconds = full_audio.size / SAMPLE_RATE
        wav_bytes = waveform_to_wav_bytes(full_audio)
        audio_base64 = base64.b64encode(wav_bytes).decode("utf-8")

        return {
            "audio_base64": audio_base64,
            "format": "wav",
            "sample_rate": SAMPLE_RATE,
            "duration_seconds": round(duration_seconds, 3),
            "voice": voice,
            "chunks": len(chunks),
            "generation_seconds": round(generation_seconds, 3),
        }
    except Exception as exc:
        traceback.print_exc()
        return {"error": str(exc)}


runpod.serverless.start({"handler": handler})
