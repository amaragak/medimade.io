# Pedalboard Lambda layer (Python 3.12)

This directory holds the **pre-built** dependency tree for [Spotify Pedalboard](https://github.com/spotify/pedalboard), used by the `voice-fx` Lambda.

## One-time (or version bump) — requires Docker

From `backend/`:

```bash
chmod +x scripts/build-pedalboard-layer
./scripts/build-pedalboard-layer
```

This uses `docker/pedalboard-layer/Dockerfile` (Amazon Linux–compatible `linux/amd64` image) and writes:

`layers/pedalboard/python/lib/python3.12/site-packages/`

**Commit `layers/pedalboard/python/`** after a successful build. Normal `cdk deploy` then does **not** need Docker.

## Updating Pedalboard

1. Edit `docker/pedalboard-layer/requirements.txt`.
2. Re-run `./scripts/build-pedalboard-layer`.
3. Commit the updated `layers/pedalboard/python/`.

## CDK

If the layer is missing, `cdk synth` fails with an explicit error pointing to this script.
