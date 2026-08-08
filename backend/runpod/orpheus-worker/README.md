# RunPod Orpheus 3B serverless worker

Serverless GPU worker for [Orpheus TTS](https://github.com/canopyai/Orpheus-TTS) via `orpheus-speech` + vLLM. Used as an alternative TTS path alongside Fish Audio.

This is **not** deployed by CDK. You build/push the Docker image, then create a RunPod Serverless endpoint in the dashboard.

## Files

| File | Purpose |
|------|---------|
| `handler.py` | RunPod entrypoint; loads Orpheus once, returns WAV as `audio_base64` |
| `Dockerfile` | `runpod/base:0.6.2-cuda12.1.0` + `orpheus-speech`, `vllm==0.7.3`, `runpod` |

## Build locally

From `backend/`:

```bash
chmod +x scripts/build-runpod-orpheus
./scripts/build-runpod-orpheus
```

Push to a registry RunPod can pull (Docker Hub, GHCR, etc.):

```bash
./scripts/build-runpod-orpheus --tag yourusername/orpheus-worker:latest --push
```

Or manually:

```bash
docker build --platform linux/amd64 -t yourusername/orpheus-worker:latest runpod/orpheus-worker
docker push yourusername/orpheus-worker:latest
```

## RunPod dashboard

1. **Serverless → New Endpoint**
2. **Docker** — image: `yourusername/orpheus-worker:latest`
3. **GPU** — 16 GB+ VRAM (e.g. A40, RTX 4090 class)
4. **Scaling** — for low traffic: min workers `0`, max per your concurrency; set min `1` if cold starts hurt batch jobs
5. Deploy — note the endpoint id and API key

## Request shape

```json
{
  "input": {
    "text": "Take a slow, deep breath in...",
    "voice": "tara"
  }
}
```

Response:

```json
{
  "audio_base64": "<WAV mono 24 kHz>"
}
```

Sync call (example):

```bash
curl -s -X POST "https://api.runpod.ai/v2/{ENDPOINT_ID}/runsync" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input":{"text":"Hello from Orpheus.","voice":"tara"}}'
```

## Wiring into medimade (later)

Store in Secrets Manager when integrating the meditation pipeline:

- `medimade/RUNPODS_API_KEY`
- `medimade/RUNPODS_URL` (runsync URL, e.g. `https://api.runpod.ai/v2/{endpoint_id}/runsync`)

The backend Fish TTS path is unchanged until you add a Lambda branch that POSTs to RunPod instead of Fish.

## Notes

- **Cold starts**: first request per worker downloads weights + inits vLLM — slow. Keep 1 warm worker for overnight batch generation if needed.
- **GitHub deploy**: RunPod can build from a repo with this `Dockerfile` + `handler.py` instead of manual push.
- **Network volume**: optional mount at `/runpod-volume` for pre-downloaded weights (smaller image, faster cold start after volume is warm).
