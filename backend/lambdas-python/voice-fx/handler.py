"""
POST /audio/voice-fx — apply a small Pedalboard chain to voice audio.

Request JSON:
  - audioBase64: encoded audio bytes (e.g. MP3 from Fish TTS, or WAV).
  - inputFormat (optional): "mp3" | "wav" | "auto" — default "auto" (RIFF/WAVE → wav, else mp3).
  - preset (optional): "neutral" | "warm" | "mixer" — effect chain (mixer = meditation sound-panel defaults).

Response JSON:
  - format: "wav"
  - sampleRate, channels
  - audioBase64: processed WAV
"""

from __future__ import annotations

import base64
import io
import json
import os
import tempfile
from typing import Any

import numpy as np
from pedalboard import Delay, Gain, HighpassFilter, LowpassFilter, Pedalboard, Reverb
from pedalboard.io import AudioFile
import boto3

TARGET_LUFS_I = -16.0


def _normalize_integrated_lufs(audio_cf: np.ndarray, sr: int) -> np.ndarray:
    """
    Normalize integrated loudness after the FX chain.

    Implemented via pyloudnorm (BS.1770 / K-weighting).
    """
    try:
        import pyloudnorm as pyln  # type: ignore
    except Exception as e:
        raise RuntimeError(
            "pyloudnorm is not available in the deployed Pedalboard layer. "
            "Rebuild/redeploy the layer after updating docker/pedalboard-layer/requirements.txt. "
            f"Import error: {e!s}"
        ) from e

    if audio_cf.size == 0:
        return audio_cf.astype(np.float32)

    n_samples = int(audio_cf.shape[1]) if audio_cf.ndim == 2 else 0
    if n_samples < int(sr * 0.25):
        return audio_cf.astype(np.float32)

    # pyloudnorm expects shape (samples, channels)
    wav = np.ascontiguousarray(audio_cf.T.astype(np.float64))
    meter = pyln.Meter(sr)
    loudness = meter.integrated_loudness(wav)
    if not np.isfinite(loudness) or loudness < -60.0:
        return audio_cf.astype(np.float32)

    normed = pyln.normalize.loudness(wav, loudness, TARGET_LUFS_I)
    out_cf = np.ascontiguousarray(normed.T.astype(np.float32))

    # Safety peak trim (avoid clipping in WAV output)
    peak = float(np.max(np.abs(out_cf))) if out_cf.size else 0.0
    if peak > 0.99:
        out_cf = (out_cf * (0.99 / peak)).astype(np.float32)
    return out_cf


def _json_response(status_code: int, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(payload),
    }


def _build_board(preset: str) -> Pedalboard:
    p = (preset or "neutral").strip().lower()
    if p == "mixer":
        # Aligned with local sound-panel tuning (delay → reverb, light wet).
        return Pedalboard(
            [
                HighpassFilter(cutoff_frequency_hz=80),
                LowpassFilter(cutoff_frequency_hz=9600),
                Gain(gain_db=1.0),
                Delay(delay_seconds=0.2, feedback=0.15, mix=0.05),
                Reverb(
                    room_size=0.22,
                    damping=0.5,
                    wet_level=0.12,
                    dry_level=0.94,
                    width=0.85,
                    freeze_mode=0.0,
                ),
            ]
        )
    if p == "warm":
        return Pedalboard(
            [
                HighpassFilter(cutoff_frequency_hz=80),
                LowpassFilter(cutoff_frequency_hz=9600),
                Gain(gain_db=1.0),
                Reverb(room_size=0.22, dry_level=0.9, wet_level=0.1, width=0.85),
            ]
        )
    return Pedalboard(
        [
            HighpassFilter(cutoff_frequency_hz=60),
            Gain(gain_db=0.5),
        ]
    )


def _ensure_channels_first(audio: np.ndarray) -> np.ndarray:
    """Pedalboard expects shape (num_channels, num_samples)."""
    if audio.ndim == 1:
        return np.array([audio], dtype=np.float32)
    if audio.ndim == 2:
        r, c = audio.shape
        # Few rows, many cols → already (channels, samples)
        if r <= 32 and c > r * 64:
            return np.ascontiguousarray(audio.astype(np.float32))
        # Few cols, many rows → (samples, channels)
        if c <= 32 and r > c * 64:
            return np.ascontiguousarray(audio.T.astype(np.float32))
        # Ambiguous: prefer more columns as samples (channels-first)
        if r < c:
            return np.ascontiguousarray(audio.astype(np.float32))
        return np.ascontiguousarray(audio.T.astype(np.float32))
    raise ValueError(f"Unsupported audio shape {audio.shape}")


def _sniff_container(raw: bytes) -> str:
    if len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WAVE":
        return "wav"
    return "mp3"


def _suffix_for_input_format(input_format: str, raw: bytes) -> str:
    f = input_format.strip().lower()
    if f == "wav":
        return ".wav"
    if f == "mp3":
        return ".mp3"
    if f == "auto":
        return ".wav" if _sniff_container(raw) == "wav" else ".mp3"
    raise ValueError(f"Unsupported inputFormat {input_format!r}")


def _read_entire_file(f: Any) -> tuple[np.ndarray, int]:
    """Read all PCM from a ReadableAudioFile (important for MP3 when frame count is estimated)."""
    sr = int(f.samplerate)
    chunk = max(4096, min(sr * 30, 524288))
    parts: list[np.ndarray] = []
    while True:
        block = f.read(chunk)
        if block.size == 0:
            break
        if block.ndim == 1:
            block = np.array([block], dtype=np.float32)
        n = block.shape[1]
        if n == 0:
            break
        parts.append(np.ascontiguousarray(block.astype(np.float32)))
        if n < chunk:
            break
    if not parts:
        raise ValueError("No audio samples decoded")
    return np.concatenate(parts, axis=1), sr


def _decode_audio_bytes(raw: bytes, input_format: str) -> tuple[np.ndarray, int]:
    suffix = _suffix_for_input_format(input_format, raw)

    def load_from(src: Any) -> tuple[np.ndarray, int]:
        with AudioFile(src) as f:
            return _read_entire_file(f)

    try:
        return load_from(io.BytesIO(raw))
    except Exception as first:
        path: str | None = None
        fd, path = tempfile.mkstemp(suffix=suffix)
        try:
            with os.fdopen(fd, "wb") as tmp:
                tmp.write(raw)
            return load_from(path)
        except Exception as second:
            raise RuntimeError(
                f"Could not decode audio (MP3/WAV via Pedalboard). "
                f"bytes={len(raw)}, inputFormat={input_format!r}. "
                f"First error: {first!s}; retry: {second!s}"
            ) from second
        finally:
            if path:
                try:
                    os.unlink(path)
                except OSError:
                    pass


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    try:
        raw_body = event.get("body") or "{}"
        if event.get("isBase64Encoded"):
            raw_body = base64.b64decode(raw_body).decode("utf-8")
        data = json.loads(raw_body)
    except Exception as e:
        return _json_response(400, {"error": f"Invalid JSON body: {e!s}"})

    # Two modes:
    # 1) HTTP preview mode: base64 in → base64 WAV out (small clips only; can hit payload limits)
    # 2) S3 mode: s3KeyIn → s3KeyOut (for long meditations; avoids large responses)
    s3_key_in = data.get("s3KeyIn")
    s3_key_out = data.get("s3KeyOut")
    bucket = data.get("bucket") or os.environ.get("MEDIA_BUCKET_NAME")
    use_s3 = (
        isinstance(bucket, str)
        and isinstance(s3_key_in, str)
        and s3_key_in.strip()
        and isinstance(s3_key_out, str)
        and s3_key_out.strip()
    )

    audio_b64 = data.get("audioBase64")
    if not use_s3:
        if not isinstance(audio_b64, str) or not audio_b64.strip():
            return _json_response(400, {"error": "Provide either { audioBase64 } or { bucket, s3KeyIn, s3KeyOut }"})

    preset = data.get("preset", "neutral")
    if not isinstance(preset, str):
        return _json_response(400, {"error": "Field `preset` must be a string if provided"})

    input_format = data.get("inputFormat", "auto")
    if not isinstance(input_format, str):
        return _json_response(400, {"error": "Field `inputFormat` must be a string if provided"})
    ifmt = input_format.strip().lower()
    if ifmt not in ("mp3", "wav", "auto"):
        return _json_response(
            400,
            {"error": "`inputFormat` must be one of: mp3, wav, auto"},
        )

    raw_audio: bytes
    if use_s3:
        s3 = boto3.client("s3")
        try:
            obj = s3.get_object(Bucket=bucket, Key=s3_key_in.strip())
            raw_audio = obj["Body"].read()
        except Exception as e:
            return _json_response(500, {"error": f"Could not read S3 input {s3_key_in!r}: {e!s}"})
    else:
        try:
            raw_audio = base64.b64decode(audio_b64, validate=True)
        except Exception as e:
            return _json_response(400, {"error": f"Invalid base64 audio: {e!s}"})

    try:
        audio, sr = _decode_audio_bytes(raw_audio, ifmt)
    except Exception as e:
        return _json_response(400, {"error": str(e)})

    try:
        audio_cf = _ensure_channels_first(np.asarray(audio, dtype=np.float32))
        pnorm = (preset or "neutral").strip().lower()
        if pnorm == "mixer":
            pad_n = int(sr * 2.0)
            if pad_n > 0:
                pad = np.zeros((audio_cf.shape[0], pad_n), dtype=np.float32)
                audio_cf = np.concatenate([audio_cf, pad], axis=1)
        board = _build_board(preset)
        processed = board(audio_cf, sr)
        processed = np.asarray(processed, dtype=np.float32)
        if processed.ndim == 1:
            processed = np.array([processed])
        processed = _normalize_integrated_lufs(processed, sr)
    except Exception as e:
        return _json_response(500, {"error": f"Processing failed: {e!s}"})

    try:
        out = io.BytesIO()
        num_channels = int(processed.shape[0])
        with AudioFile(out, "w", sr, num_channels, format="wav") as f:
            f.write(processed)
        out_wav = out.getvalue()
    except Exception as e:
        return _json_response(500, {"error": f"Encode failed: {e!s}"})

    if use_s3:
        s3 = boto3.client("s3")
        try:
            s3.put_object(
                Bucket=bucket,
                Key=s3_key_out.strip(),
                Body=out_wav,
                ContentType="audio/wav",
                CacheControl="public, max-age=31536000, immutable",
            )
        except Exception as e:
            return _json_response(500, {"error": f"Could not write S3 output {s3_key_out!r}: {e!s}"})
        return _json_response(
            200,
            {
                "format": "wav",
                "sampleRate": sr,
                "channels": num_channels,
                "preset": preset.strip().lower() if isinstance(preset, str) else "neutral",
                "inputFormat": ifmt,
                "bucket": bucket,
                "s3KeyOut": s3_key_out.strip(),
            },
        )

    return _json_response(
        200,
        {
            "format": "wav",
            "sampleRate": sr,
            "channels": num_channels,
            "preset": preset.strip().lower() if isinstance(preset, str) else "neutral",
            "inputFormat": ifmt,
            "audioBase64": base64.b64encode(out_wav).decode("ascii"),
        },
    )
