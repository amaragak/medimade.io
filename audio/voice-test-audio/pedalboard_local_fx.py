#!/usr/bin/env python3
"""
Local Pedalboard voice FX — tune reverb / delay (echo) against WAV or MP3.

Easiest: use the runner (creates a gitignored .venv here on first run, pins pedalboard like Lambda):

  ./audio/voice-test-audio/run-pedalboard-fx audio/voice-test-audio/emily1.mp3

Default output (when you omit the second path) is beside the input:

  <stem>-wet.wav                     if you did not pass any optional flags
  <stem>-<only flags you passed>.wav otherwise (see --help epilog)

Omitted flags still use built-in processing defaults; they are simply not encoded in the name.

Optional second argument overrides the output path.

Or with your own Python + deps installed:

  python3 audio/voice-test-audio/pedalboard_local_fx.py clip.wav --reverb-wet-level 0.2
"""

from __future__ import annotations

import argparse
import io
import re
import sys
from pathlib import Path
from typing import Any

import numpy as np
from pedalboard import Delay, Gain, HighpassFilter, LowpassFilter, Pedalboard, Reverb
from pedalboard.io import AudioFile

# Used for audio processing when a flag is omitted from the CLI (not written into the filename).
PROCESS_DEFAULTS: dict[str, Any] = {
    "base": "lambda-warm",
    "tail_pad_seconds": 2.0,
    "no_delay": False,
    "no_reverb": False,
    "delay_seconds": 0.08,
    "delay_feedback": 0.2,
    "delay_mix": 0.22,
    "reverb_room_size": 0.22,
    "reverb_damping": 0.5,
    "reverb_wet_level": 0.1,
    "reverb_dry_level": 0.9,
    "reverb_width": 0.85,
    "reverb_freeze_mode": 0.0,
    "order": "delay-first",
}

_SUP = argparse.SUPPRESS


def _ensure_channels_first(audio: np.ndarray) -> np.ndarray:
    """Same layout rules as lambdas-python/voice-fx/handler.py."""
    if audio.ndim == 1:
        return np.array([audio], dtype=np.float32)
    if audio.ndim == 2:
        r, c = audio.shape
        if r <= 32 and c > r * 64:
            return np.ascontiguousarray(audio.astype(np.float32))
        if c <= 32 and r > c * 64:
            return np.ascontiguousarray(audio.T.astype(np.float32))
        if r < c:
            return np.ascontiguousarray(audio.astype(np.float32))
        return np.ascontiguousarray(audio.T.astype(np.float32))
    raise ValueError(f"Unsupported audio shape {audio.shape}")


def _base_chain(kind: str) -> list:
    k = kind.strip().lower()
    if k == "lambda-warm":
        return [
            HighpassFilter(cutoff_frequency_hz=80),
            LowpassFilter(cutoff_frequency_hz=9600),
            Gain(gain_db=1.0),
        ]
    if k == "lambda-neutral":
        return [
            HighpassFilter(cutoff_frequency_hz=60),
            Gain(gain_db=0.5),
        ]
    if k == "none":
        return []
    raise ValueError(f"Unknown --base {kind!r}")


def _read_entire_file(f: Any) -> tuple[np.ndarray, int]:
    """Full decode (same idea as voice-fx Lambda; helps MP3 when frame count is estimated)."""
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


def _fmt_num(x: float) -> str:
    if x == int(x):
        return str(int(x))
    s = f"{x:.4f}".rstrip("0").rstrip(".")
    return s if s else "0"


def _slug_token(s: str) -> str:
    t = re.sub(r"[^0-9A-Za-z._]+", "_", s.strip("_"))
    return t if t else "x"


def _explicit_from_ns(ns: argparse.Namespace) -> dict[str, Any]:
    skip = frozenset({"input_audio", "output_wav"})
    return {k: v for k, v in vars(ns).items() if k not in skip}


def _merge_process_args(explicit: dict[str, Any]) -> argparse.Namespace:
    merged = {**PROCESS_DEFAULTS, **explicit}
    return argparse.Namespace(**merged)


def _filename_tokens(explicit: dict[str, Any]) -> list[str]:
    """Only CLI-provided options; stable order."""
    parts: list[str] = []
    if "base" in explicit:
        parts.append(
            _slug_token({"lambda-warm": "blw", "lambda-neutral": "bln", "none": "bno"}[explicit["base"]])
        )
    if "tail_pad_seconds" in explicit:
        parts.append(_slug_token(f"tp{_fmt_num(float(explicit['tail_pad_seconds']))}"))

    if explicit.get("no_delay"):
        parts.append("ndly")
    else:
        for key, prefix in (
            ("delay_seconds", "ds"),
            ("delay_feedback", "dfb"),
            ("delay_mix", "dmx"),
        ):
            if key in explicit:
                parts.append(_slug_token(f"{prefix}{_fmt_num(float(explicit[key]))}"))

    if explicit.get("no_reverb"):
        parts.append("nrev")
    else:
        for key, prefix in (
            ("reverb_room_size", "rr"),
            ("reverb_damping", "rd"),
            ("reverb_wet_level", "rwet"),
            ("reverb_dry_level", "rdry"),
            ("reverb_width", "rwid"),
            ("reverb_freeze_mode", "rfz"),
        ):
            if key in explicit:
                parts.append(_slug_token(f"{prefix}{_fmt_num(float(explicit[key]))}"))

    if "order" in explicit:
        parts.append("odf" if explicit["order"] == "delay-first" else "orf")
    return parts


def _default_output_path(inp: Path, explicit: dict[str, Any]) -> Path:
    tokens = _filename_tokens(explicit)
    if not tokens:
        return inp.parent / f"{inp.stem}-wet.wav"
    return inp.parent / f"{inp.stem}-{'-'.join(tokens)}.wav"


_DEFAULT_OUTPUT_HELP = """
Default output (no second path): beside input, name encodes only flags you actually pass.

  <stem>-wet.wav                         no optional flags on the command line
  <stem>-rwet0.2.wav                     example: only --reverb-wet-level 0.2

Token legend (each appears only if you passed the matching flag):

  blw / bln / bno     --base lambda-warm | lambda-neutral | none
  tp<N>               --tail-pad-seconds
  ndly                --no-delay
  ds dfb dmx          --delay-seconds, --delay-feedback, --delay-mix (each only if passed)
  nrev                --no-reverb
  rr rd rwet rdry rwid rfz   matching --reverb-* flags you pass
  odf / orf           --order delay-first | reverb-first

Omitted flags still use built-in defaults for processing; they are not shown in the filename.
"""


def main() -> int:
    p = argparse.ArgumentParser(
        description="Apply Pedalboard delay + reverb to WAV or MP3 (local tuning; mirrors voice-fx Lambda).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=_DEFAULT_OUTPUT_HELP,
    )
    p.add_argument("input_audio", type=Path, help="Input path (.wav, .mp3, …)")
    p.add_argument(
        "output_wav",
        type=Path,
        nargs="?",
        default=None,
        help="Output WAV path (default: <stem>-wet.wav or <stem>-<explicit-flags>.wav beside input)",
    )
    p.add_argument(
        "--base",
        choices=("lambda-warm", "lambda-neutral", "none"),
        default=_SUP,
        help="Front of chain (same idea as voice-fx Lambda presets); default: lambda-warm",
    )
    p.add_argument(
        "--tail-pad-seconds",
        type=float,
        default=_SUP,
        metavar="SEC",
        help="Silence appended before FX so tails are not truncated; default: 2",
    )
    p.add_argument("--no-delay", action="store_true", default=_SUP, help="Omit Delay (echo)")
    p.add_argument("--no-reverb", action="store_true", default=_SUP, help="Omit Reverb")

    p.add_argument("--delay-seconds", type=float, default=_SUP, help="Delay time (seconds); default: 0.08")
    p.add_argument("--delay-feedback", type=float, default=_SUP, help="Delay feedback 0..1; default: 0.2")
    p.add_argument("--delay-mix", type=float, default=_SUP, help="Delay wet mix 0..1; default: 0.22")

    p.add_argument("--reverb-room-size", type=float, default=_SUP)
    p.add_argument("--reverb-damping", type=float, default=_SUP)
    p.add_argument("--reverb-wet-level", type=float, default=_SUP)
    p.add_argument("--reverb-dry-level", type=float, default=_SUP)
    p.add_argument("--reverb-width", type=float, default=_SUP)
    p.add_argument("--reverb-freeze-mode", type=float, default=_SUP)

    p.add_argument(
        "--order",
        choices=("delay-first", "reverb-first"),
        default=_SUP,
        help="Delay vs reverb order; default: delay-first",
    )

    args = p.parse_args()
    inp = args.input_audio
    explicit = _explicit_from_ns(args)
    eff = _merge_process_args(explicit)

    if not inp.is_file():
        print(f"Input not found: {inp}", file=sys.stderr)
        return 1

    out_path = args.output_wav
    if out_path is None:
        out_path = _default_output_path(inp, explicit)
    if out_path.resolve() == inp.resolve():
        print("Refusing to overwrite the input file; choose a different output path.", file=sys.stderr)
        return 1

    try:
        with AudioFile(str(inp)) as f:
            audio, sr = _read_entire_file(f)
    except Exception as e:
        print(f"Could not read audio: {e}", file=sys.stderr)
        return 1

    audio_cf = _ensure_channels_first(np.asarray(audio, dtype=np.float32))

    if eff.tail_pad_seconds > 0:
        pad_n = int(sr * eff.tail_pad_seconds)
        if pad_n > 0:
            pad = np.zeros((audio_cf.shape[0], pad_n), dtype=np.float32)
            audio_cf = np.concatenate([audio_cf, pad], axis=1)

    plugins: list = _base_chain(eff.base)

    delay = Delay(
        delay_seconds=eff.delay_seconds,
        feedback=eff.delay_feedback,
        mix=eff.delay_mix,
    )
    reverb = Reverb(
        room_size=eff.reverb_room_size,
        damping=eff.reverb_damping,
        wet_level=eff.reverb_wet_level,
        dry_level=eff.reverb_dry_level,
        width=eff.reverb_width,
        freeze_mode=eff.reverb_freeze_mode,
    )

    if not eff.no_delay and not eff.no_reverb:
        if eff.order == "delay-first":
            plugins.extend([delay, reverb])
        else:
            plugins.extend([reverb, delay])
    elif not eff.no_delay:
        plugins.append(delay)
    elif not eff.no_reverb:
        plugins.append(reverb)

    if not plugins:
        print("Nothing to apply (empty chain). Use a different --base or enable delay/reverb.", file=sys.stderr)
        return 1

    board = Pedalboard(plugins)
    try:
        processed = board(audio_cf, sr)
        processed = np.asarray(processed, dtype=np.float32)
        if processed.ndim == 1:
            processed = np.array([processed])
    except Exception as e:
        print(f"Processing failed: {e}", file=sys.stderr)
        return 1

    out = io.BytesIO()
    num_channels = int(processed.shape[0])
    try:
        with AudioFile(out, "w", sr, num_channels, format="wav") as f:
            f.write(processed)
    except Exception as e:
        print(f"Encode failed: {e}", file=sys.stderr)
        return 1

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(out.getvalue())
    print(f"Wrote {out_path} ({num_channels} ch, {sr} Hz, {processed.shape[1]} samples)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
