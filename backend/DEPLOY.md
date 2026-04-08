# medimade backend (AWS CDK)

SST was removed in favor of the **AWS CDK** so deploys use one consistent toolchain (`aws-cdk` + `aws-cdk-lib`).

## Secret name (AWS Secrets Manager)

Create a secret with this **exact name** (full path string):

| Secret name | Value |
|-------------|--------|
| **`medimade/FISH_AUDIO_API_KEY`** | Your Fish Audio API key (plain text as the secret string) |
| **`medimade/CLAUDE_API_KEY`** | Your Anthropic API key for Claude (plain text as the secret string) |

Create or update them **before** you exercise the API (stack deploy can succeed even if a secret does not exist yet; the Lambda that needs it will fail until the secret is present).

```bash
aws secretsmanager create-secret \
  --name medimade/FISH_AUDIO_API_KEY \
  --secret-string "YOUR_FISH_AUDIO_KEY" \
  --profile mm
```

```bash
aws secretsmanager create-secret \
  --name medimade/CLAUDE_API_KEY \
  --secret-string "YOUR_ANTHROPIC_KEY" \
  --profile mm
```

To rotate:

```bash
aws secretsmanager put-secret-value \
  --secret-id medimade/FISH_AUDIO_API_KEY \
  --secret-string "NEW_KEY" \
  --profile mm
```

```bash
aws secretsmanager put-secret-value \
  --secret-id medimade/CLAUDE_API_KEY \
  --secret-string "NEW_KEY" \
  --profile mm
```

## Prerequisites

- Node.js 18+
- AWS CLI configured (e.g. `--profile mm`)
- CDK bootstrap **once** per account + Region

## Install

```bash
cd backend
npm install
```

## Pedalboard layer (voice FX Lambda) — Docker **once**, then commit

The **`VoiceFxFunction`** (`POST /audio/voice-fx`) uses Spotify **Pedalboard** via a Lambda **layer** built in Docker against **Amazon Linux (linux/amd64)**. You do **not** need Docker for normal `cdk deploy` after the layer exists in git.

1. Install [Docker](https://docs.docker.com/get-docker/).
2. From `backend/`:

   ```bash
   npm run build-pedalboard-layer
   ```

3. Commit **`layers/pedalboard/python/`** (large; expected).

Bump Pedalboard or Python deps (`pyloudnorm`, `scipy` for **~-16 LUFS** normalization after the FX chain): edit `docker/pedalboard-layer/requirements.txt`, re-run the script, commit again. Details: `layers/pedalboard/README.md`.

Fish TTS MP3s and meditation speech stems are normalized to **~-16 LUFS** in Node via **ffmpeg `loudnorm`** (requires the ffmpeg Lambda layer on `FishTtsFunction` and the meditation worker). Rebuild and redeploy the Pedalboard layer after pulling changes that add `pyloudnorm`/`scipy`.

If `cdk synth` errors about a missing Pedalboard layer, run the step above first.

## Bootstrap (once per account/region)

This project defaults to **`ap-southeast-2`** in `bin/medimade.ts`. Bootstrap that account + region once:

```bash
npx cdk bootstrap aws://382309212161/ap-southeast-2 --profile mm
```

Or derive account from the CLI:

```bash
npx cdk bootstrap aws://$(aws sts get-caller-identity --profile mm --query Account --output text)/ap-southeast-2 --profile mm
```

## Deploy

```bash
npx cdk deploy --all --profile mm
```

Confirm changes when prompted, or add `--require-approval never` for CI.

After deploy, note **CloudFormation outputs**: `ApiUrl`, `FishTtsUrl`, `VoiceFxUrl`, `MedimadeChatUrl`, `FishAudioSecretName`, `ClaudeSecretName`.

Set **`NEXT_PUBLIC_MEDIMADE_CHAT_URL`** in the webapp to **`MedimadeChatUrl`** (Lambda Function URL with response streaming). `scripts/deploy-back` writes API base, chat URL, and (when present) media CDN base into **`frontend/webapp/.env`** (`NEXT_PUBLIC_*`) and **`frontend/mobile/.env`** (`EXPO_PUBLIC_*`).

Public function URLs now require **both** `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction` (URL-only) on the function policy; the stack adds both. If you still see **403 Forbidden**, redeploy and confirm `.env` points at **`MedimadeChatUrl`**, not the old API Gateway `/chat` path.

## API

- **POST** `{FishTtsUrl}`  
- Body: `{ "text": string, "reference_id": string }`  
- Success: `200`, `audio/mpeg` (base64 in API Gateway)

- **POST** `{MedimadeChatUrl}` (Claude Haiku, **streams** via Lambda response streaming)  

**Coach chat** — body:
`{ "mode": "chat", "meditationStyle": string, "messages": [{ "role": "user" | "assistant", "content": string }, ...] }`  
(`mode` may be omitted; defaults to chat.) Last message must be from `user`.

**Generate ~5 min script** — body:
`{ "mode": "generate_script", "meditationStyle": string (optional), "transcript": string }`  
`transcript` is the full UI chat log (plain text). Uses higher `max_tokens` for long scripts.

- Success: `200`, **`text/event-stream`** (SSE). Each event is `data: {"d":"…token chunk…"}\n\n`; final event includes `"done":true`. Errors use JSON before the stream or `data: {"error":"…"}`.

- **POST** `{ApiUrl}/audio/voice-fx` (Python + Pedalboard; **MP3 or WAV** in, **WAV** out as base64)  
  Body: `{ "audioBase64": string, "preset"?: "neutral" | "warm" | "mixer", "inputFormat"?: "mp3" | "wav" | "auto" }`  
  **`mixer`**: light delay + reverb (sound-mixer defaults; 2s tail pad before processing).  
  `inputFormat` defaults to **`auto`** (detects RIFF/WAVE vs everything else such as Fish **MP3**).  
  Success: `200` JSON `{ "format":"wav", "sampleRate", "channels", "audioBase64", "preset", "inputFormat" }`  

Speaker preview **`*-fx.wav`** files (same Pedalboard chain) are produced by `npm run generate-speaker-samples` when `MEDIIMADE_API_URL` (or stack `ApiUrl`) is resolvable.

## Destroy

```bash
npx cdk destroy --all --profile mm
```

## Telemetry

The **AWS CDK** may print its own notices. This project no longer uses SST; SST telemetry does not apply.
