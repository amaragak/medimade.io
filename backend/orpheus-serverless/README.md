# Orpheus 3B TTS — RunPod Serverless

Queue-based RunPod Serverless worker for [`canopylabs/orpheus-3b-0.1-ft`](https://huggingface.co/canopylabs/orpheus-3b-0.1-ft) with SNAC audio decoding.

**This is not a FastAPI/Gradio HTTP server.** RunPod Serverless never sends HTTP to the container — it dispatches jobs through a queue that the worker polls via:

```python
runpod.serverless.start({"handler": handler})
```

Images like `nexslerdev/orpheus-fastapi-tts` start a web server, log `Pod Started`, and idle forever while billing GPU time. This worker uses the RunPod handler loop instead.

---

## Layout

```
backend/orpheus-serverless/
├── handler.py          # worker (models loaded at import)
├── Dockerfile          # CUDA image with weights baked in
├── requirements.txt
├── test_local.py       # GPU sanity check before deploy
├── README.md
├── .dockerignore
└── .gitignore
```

Self-contained — do **not** merge these deps into the main backend `package.json` or app Python env.

---

## Local GPU test (before Docker)

Requires a CUDA machine with ~8GB+ VRAM free after model load.

```bash
cd backend/orpheus-serverless
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# First run downloads ~6GB from HuggingFace (not baked yet)
python test_local.py
# → writes test_output.wav (gitignored)
```

**Listen to `test_output.wav`** before trusting the Docker image. The SNAC layer redistribution and audio-token offset math are the error-prone parts of this pipeline — bad offsets produce garbage/static, not a loud error.

---

## Build & push

Run from **`backend/orpheus-serverless/`**. The image is ~15–18GB with weights baked in (intentional). **Need ~40GB free disk** for local builds.

### Option A — local Docker (needs ~40GB free disk + `docker login`)

```bash
cd backend
npm run build-orpheus-serverless -- --tag YOUR_DOCKERUSER/orpheus-serverless:v1 --push YOUR_DOCKERUSER/orpheus-serverless:v1
```

### Option B — GitHub Actions (recommended if local disk is tight)

1. Add repo secrets: **`DOCKERHUB_USERNAME`**, **`DOCKERHUB_TOKEN`**
2. Actions → **Orpheus Serverless Docker** → **Run workflow**
3. Use the pushed image ref on your RunPod endpoint

### Option C — manual from this directory

```bash
cd backend/orpheus-serverless
export IMAGE=yourusername/orpheus-serverless:v1
docker build --platform linux/amd64 -t "$IMAGE" .
docker push "$IMAGE"
```

---

## RunPod endpoint configuration

Create a **Serverless** endpoint (queue-based, **not** load-balancing) with this image.

| Setting | Value | Notes |
|--------|-------|-------|
| **GPU** | 24GB tier | A5000, RTX 4090, L4, etc. |
| **Container disk** | **25GB minimum** | Weights + runtime |
| **Max workers** | **1** while testing | Prevents runaway parallel GPU spend |
| **Active (min) workers** | **0** | ⚠️ **Must be 0.** Any value > 0 bills 24/7 whether jobs arrive or not — the most common silent balance drain. |
| **Idle timeout** | 5–10s while testing | Workers scale down quickly when idle |
| **FlashBoot** | On | Faster re-starts after scale-from-zero |
| **Execution timeout** | 600s+ | Long meditation scripts need headroom |

After deploy, copy the endpoint **runsync URL**, e.g.:

`https://api.runpod.ai/v2/<endpoint-id>/runsync`

Point `medimade/RUNPODS_URL` in AWS Secrets Manager at that URL (or `/run` for async).

---

## Calling the endpoint

### Input

```json
{
  "input": {
    "text": "Settle in. <sigh> Let your shoulders drop.",
    "voice": "tara",
    "temperature": 0.6,
    "top_p": 0.95,
    "repetition_penalty": 1.1,
    "max_chunk_chars": 350,
    "max_seconds_per_chunk": 45
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `text` | *(required)* | Speech text. Emotion tags pass through: `<sigh>`, `<laugh>`, `<gasp>`, `<yawn>`, `<groan>`, `<chuckle>`, `<cough>`, `<sniffle>` |
| `voice` | `tara` | One of: `tara`, `leah`, `jess`, `leo`, `dan`, `mia`, `zac`, `zoe` |
| `temperature` | `0.6` | Sampling temperature |
| `top_p` | `0.95` | Nucleus sampling |
| `repetition_penalty` | `1.1` | **Floored at 1.1** — lower values cause looping artefacts |
| `max_chunk_chars` | `350` | Sentence-aware chunk size for long scripts |
| `max_seconds_per_chunk` | `45` | Caps `max_new_tokens` per chunk |

Long text is split at sentence boundaries, synthesized per chunk, joined with 0.3s silence.

### Output

```json
{
  "audio_base64": "...",
  "format": "wav",
  "sample_rate": 24000,
  "duration_seconds": 6.4,
  "voice": "tara",
  "chunks": 1,
  "generation_seconds": 4.1
}
```

Mono 16-bit PCM WAV at 24 kHz, base64-encoded.

Errors return `{"error": "..."}`.

### `/runsync` (short text)

Blocks up to **90s**. Fine for preview clips and short samples.

```bash
curl -sS -X POST "https://api.runpod.ai/v2/$ENDPOINT_ID/runsync" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "text": "Welcome to your personalised meditation.",
      "voice": "tara"
    }
  }' | jq '{status, error, duration: .output.duration_seconds}'
```

### `/run` + `/status` (long meditations)

Meditation scripts exceed the 90s sync cap. Submit async, poll until `COMPLETED`:

```bash
JOB=$(curl -sS -X POST "https://api.runpod.ai/v2/$ENDPOINT_ID/run" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input":{"text":"…long script…","voice":"tara"}}' | jq -r .id)

curl -sS "https://api.runpod.ai/v2/$ENDPOINT_ID/status/$JOB" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" | jq .status
```

Medimade backend (`backend/lib/orpheus-tts-client.ts`) already supports `/run` polling and cancel.

---

## Medimade integration

1. Deploy this image to a RunPod Serverless endpoint.
2. Set AWS secrets:
   - `medimade/RUNPODS_API_KEY` — RunPod API key
   - `medimade/RUNPODS_URL` — `https://api.runpod.ai/v2/<id>/runsync`
3. RunPod input shape matches what the backend sends inside `input`:

```json
{
  "input": {
    "model": "orpheus",
    "input": "<text>",
    "voice": "tara",
    "response_format": "wav",
    "speed": 0.9
  }
}
```

This worker reads **`input.text`** or **`input.input`** (Medimade backend OpenAI-shaped field). Direct RunPod calls can use either.

---

## Cost estimates (rough)

| Phase | Time | Billed |
|-------|------|--------|
| Cold start (weights baked in) | ~20–60s | GPU while worker initializes + loads models to VRAM |
| Cold start (weights **not** baked) | 4+ min | Same, plus HF download — avoid |
| Short preview (~40 chars) | ~5–15s gen | GPU while job runs |
| Active workers > 0 | 24/7 | **Always** — even with zero requests |

Use **max workers = 1**, **active workers = 0** during development.

---

## Troubleshooting

### Worker shows "ready" but never picks up jobs

The image is **not** running a RunPod handler loop. Confirm logs show:

```
[orpheus-serverless] Worker starting — loading models…
[orpheus-serverless] Tokenizer loaded in …
```

If you only see `Pod Started` / `Start script(s) finished, pod is ready to use` with no handler output, you deployed a **FastAPI/Gradio** image by mistake — switch to this image.

### Jobs stuck `IN_QUEUE`, zero workers

- Check **max workers ≥ 1** and endpoint not paused
- Check RunPod balance / GPU availability
- Purge stale queue: `POST /v2/{id}/purge-queue`

### Jobs fail immediately

- Check worker logs for OOM — need 24GB GPU tier
- Container disk < 25GB — increase in endpoint settings

### Audio is static / robotic loops

- SNAC code extraction or layer redistribution is wrong — re-run `test_local.py` on GPU and listen
- Lower `repetition_penalty` below 1.1 causes degeneration (handler floors at 1.1)

### Cold starts very slow

- Weights not baked into image — rebuild with the provided `Dockerfile` `snapshot_download` step
- First request after idle always pays cold-start cost with active workers = 0

### Health check

```bash
curl -sS -H "Authorization: Bearer $RUNPOD_API_KEY" \
  "https://api.runpod.ai/v2/$ENDPOINT_ID/health" | jq .
```

`inQueue > 0` with `workers.running = 0` → workers not provisioning (config/credits).

---

## What not to commit

Never commit:

- `*.wav` / `test_output.wav`
- `models/`, `.cache/`, `*.safetensors`, `*.bin`, `*.pth`
- `.venv/`, `__pycache__/`

All covered by `.gitignore` in this directory.
