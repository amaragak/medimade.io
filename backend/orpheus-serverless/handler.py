"""
RunPod Serverless worker for Orpheus 3B TTS.

Uses runpod.serverless.start() — NOT a FastAPI/Gradio HTTP server.
"""

from __future__ import annotations

import base64
import io
import os
import re
import sys
import time
import traceback
import wave
from typing import Any

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
TOKEN_START_HUMAN = 128259
TOKEN_END_TEXT = 128009
TOKEN_END_HUMAN = 128260
TOKEN_START_AUDIO = 128257
TOKEN_END_AUDIO = 128258
AUDIO_TOKEN_OFFSET = 128266
TOKENS_PER_SECOND = 86

SAMPLE_RATE = 24000
SILENCE_BETWEEN_CHUNKS_SEC = 0.3

VALID_VOICES = frozenset({"tara", "leah", "jess", "leo", "dan", "mia", "zac", "zoe"})
DEFAULT_VOICE = "tara"

ORPHEUS_MODEL_PATH = os.environ.get("ORPHEUS_MODEL_PATH", "/models/orpheus-3b")
SNAC_MODEL_PATH = os.environ.get("SNAC_MODEL_PATH", "/models/snac")

tokenizer = None
orpheus_model = None
snac_model = None


def log(message: str, **fields: object) -> None:
    suffix = ""
    if fields:
        parts = " ".join(f"{k}={v!r}" for k, v in fields.items())
        suffix = f" ({parts})"
    print(f"[orpheus-serverless] {message}{suffix}", flush=True)


def log_boot_environment() -> None:
    log("boot environment", python=sys.version.split()[0], pid=os.getpid())
    log(
        "env",
        ORPHEUS_MODEL_PATH=ORPHEUS_MODEL_PATH,
        SNAC_MODEL_PATH=SNAC_MODEL_PATH,
        HF_LOCAL_FILES_ONLY=os.environ.get("HF_LOCAL_FILES_ONLY", ""),
    )
    for label, path in (("orpheus", ORPHEUS_MODEL_PATH), ("snac", SNAC_MODEL_PATH)):
        if os.path.isdir(path):
            files = sorted(os.listdir(path))[:15]
            log(f"{label} dir ok", path=path, files=files)
        else:
            log(f"{label} dir MISSING", path=path)


def load_models() -> None:
    """Load models once per worker process. Raises on failure."""
    global tokenizer, orpheus_model, snac_model

    import torch
    from snac import SNAC
    from transformers import AutoModelForCausalLM, AutoTokenizer

    log_boot_environment()

    if not torch.cuda.is_available():
        raise RuntimeError(
            "CUDA is not available — this worker requires a GPU endpoint. "
            f"torch={torch.__version__} cuda={torch.version.cuda}",
        )

    device = torch.device("cuda:0")
    props = torch.cuda.get_device_properties(0)
    cc = f"{props.major}.{props.minor}"
    log(
        "cuda ready",
        gpu=props.name,
        vram_gb=round(props.total_memory / 1e9, 1),
        compute_capability=cc,
        torch=torch.__version__,
    )
    if props.major >= 12:
        log(
            "Blackwell GPU detected — requires torch 2.7+ cu128 (this image)",
        )

    local_only = os.environ.get("HF_LOCAL_FILES_ONLY", "1") == "1"
    hf_token = os.environ.get("HF_TOKEN", "").strip() or None

    orpheus_config = os.path.join(ORPHEUS_MODEL_PATH, "config.json")
    if not os.path.isfile(orpheus_config):
        raise FileNotFoundError(
            f"Orpheus weights not found at {ORPHEUS_MODEL_PATH}. "
            "Rebuild the Docker image (download_models.py bakes weights to this path).",
        )

    cold_start = time.perf_counter()

    t0 = time.perf_counter()
    log("loading tokenizer", path=ORPHEUS_MODEL_PATH)
    tokenizer = AutoTokenizer.from_pretrained(
        ORPHEUS_MODEL_PATH,
        local_files_only=local_only,
        token=hf_token,
    )
    log("tokenizer loaded", seconds=round(time.perf_counter() - t0, 1))

    t1 = time.perf_counter()
    log("loading Orpheus LM", path=ORPHEUS_MODEL_PATH, dtype="bfloat16")
    orpheus_model = AutoModelForCausalLM.from_pretrained(
        ORPHEUS_MODEL_PATH,
        local_files_only=local_only,
        token=hf_token,
        torch_dtype=torch.bfloat16,
        device_map={"": 0},
    )
    orpheus_model.eval()
    log("Orpheus LM loaded", seconds=round(time.perf_counter() - t1, 1))

    t2 = time.perf_counter()
    log("loading SNAC decoder", path=SNAC_MODEL_PATH)
    snac_model = SNAC.from_pretrained(SNAC_MODEL_PATH)
    snac_model = snac_model.to(device).eval()
    log(
        "SNAC loaded",
        seconds=round(time.perf_counter() - t2, 1),
        cold_start_seconds=round(time.perf_counter() - cold_start, 1),
    )


def split_text_into_chunks(text: str, max_chunk_chars: int) -> list[str]:
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


def build_prompt_ids(voice: str, text: str):
    import torch

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


def extract_audio_codes(generated) -> list[int]:
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


def redistribute_codes_to_layers(codes: list[int]) -> list:
    import torch

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


def decode_codes_to_waveform(codes: list[int]):
    import numpy as np

    if len(codes) < 7:
        return np.array([], dtype=np.float32)

    code_tensors = redistribute_codes_to_layers(codes)
    import torch

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
):
    import torch

    input_ids = build_prompt_ids(voice, text)
    max_new_tokens = min(int(max_seconds_per_chunk * TOKENS_PER_SECOND), 8192)
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


def concatenate_with_silence(segments: list) -> Any:
    import numpy as np

    if not segments:
        return np.array([], dtype=np.float32)
    silence = np.zeros(
        int(SILENCE_BETWEEN_CHUNKS_SEC * SAMPLE_RATE),
        dtype=np.float32,
    )
    parts: list = []
    for seg in segments:
        if seg.size == 0:
            continue
        if parts:
            parts.append(silence)
        parts.append(seg.astype(np.float32, copy=False))
    if not parts:
        return np.array([], dtype=np.float32)
    return np.concatenate(parts)


def waveform_to_wav_bytes(audio) -> bytes:
    import numpy as np

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

        log("job started", voice=voice, chunks=len(chunks), text_chars=len(text))
        gen_started = time.perf_counter()
        wave_segments = []

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
            log(
                f"chunk {chunk_idx}/{len(chunks)} done",
                audio_seconds=round(chunk_seconds, 2),
                gen_seconds=round(time.perf_counter() - chunk_started, 2),
                chars=len(chunk_text),
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

        log(
            "job complete",
            duration_seconds=round(duration_seconds, 2),
            generation_seconds=round(generation_seconds, 2),
        )
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
        log("job error", error=str(exc))
        traceback.print_exc()
        return {"error": str(exc)}


def main() -> None:
    log("worker process starting")
    try:
        load_models()
    except Exception as exc:
        log("FATAL: model load failed — worker exiting", error=str(exc))
        traceback.print_exc()
        sys.exit(1)

    import runpod

    log("entering RunPod handler loop (runpod.serverless.start)")
    runpod.serverless.start({"handler": handler})


if __name__ == "__main__":
    main()
