# medimade backend (AWS CDK)

SST was removed in favor of the **AWS CDK** so deploys use one consistent toolchain (`aws-cdk` + `aws-cdk-lib`).

## Secret name (AWS Secrets Manager)

Create a secret with this **exact name** (full path string):

| Secret name | Value |
|-------------|--------|
| **`medimade/FISH_AUDIO_API_KEY`** | Your Fish Audio API key (plain text as the secret string) |
| **`medimade/CLAUDE_API_KEY`** | Your Anthropic API key for Claude (plain text as the secret string) |
| **`medimade/OPENAI_API_KEY`** | Your OpenAI API key (plain text; used for **Whisper** journal transcription via `POST /journal/transcribe`) |

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

```bash
aws secretsmanager create-secret \
  --name medimade/OPENAI_API_KEY \
  --secret-string "YOUR_OPENAI_KEY" \
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

### Repo deploy helper (`scripts/deploy-back`)

From the repo, `backend/scripts/deploy-back` runs CDK deploy and refreshes web/mobile `.env` files. It **defaults `AWS_PROFILE` to `mm`** when you have not set `AWS_PROFILE` and you did not pass `--profile` on the command line. Override with `--profile other` or by exporting `AWS_PROFILE` first.

After deploy, note **CloudFormation outputs**: `ApiUrl`, `FishTtsUrl`, `VoiceFxUrl`, `MedimadeChatUrl`, `FishAudioSecretName`, `ClaudeSecretName`.

Set **`NEXT_PUBLIC_MEDIMADE_CHAT_URL`** in the webapp to **`MedimadeChatUrl`** (Lambda Function URL with response streaming). `scripts/deploy-back` writes API base, chat URL, and (when present) media CDN base into **`frontend/webapp/.env`** (`NEXT_PUBLIC_*`) and **`frontend/mobile/.env`** (`EXPO_PUBLIC_*`).

Public function URLs now require **both** `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction` (URL-only) on the function policy; the stack adds both. If you still see **403 Forbidden**, redeploy and confirm `.env` points at **`MedimadeChatUrl`**, not the old API Gateway `/chat` path.

### Auth (magic link)

Magic-link auth requires:

- A Brevo transactional email setup (API key in Secrets Manager).
- CDK context values:
  - **`authEmailFrom`**: the sender email address (must be allowed in Brevo, e.g. `noreply@yourdomain.com`)
  - **`authWebappOrigin`**: where users land after clicking the email link (e.g. `http://localhost:3000` for dev, or your deployed webapp origin)

Create the Brevo API key secret (same pattern as other secrets):

| Secret name | Value |
|-------------|--------|
| **`medimade/BREVO_API_KEY`** | Your Brevo API key (plain text as the secret string) |

Example:

```bash
aws secretsmanager create-secret \
  --name medimade/BREVO_API_KEY \
  --secret-string "YOUR_BREVO_KEY" \
  --profile mm
```

You can provide these either as CDK context:

```bash
cd backend
npx cdk deploy --all \
  -c authEmailFrom="noreply@yourdomain.com" \
  -c authWebappOrigin="http://localhost:3000" \
  --profile mm
```

Or via the repo helper `backend/scripts/deploy-back` using env vars (recommended):

```bash
export MEDIMADE_AUTH_EMAIL_FROM="noreply@yourdomain.com"
export MEDIMADE_AUTH_WEBAPP_ORIGIN="http://localhost:3000"
backend/scripts/deploy-back --profile mm
```

If you see `Auth email is not configured (set MAGIC_LINK_TABLE_NAME, AUTH_EMAIL_FROM, AUTH_WEBAPP_ORIGIN on the Lambda)`,
it means `authEmailFrom` and/or `authWebappOrigin` were not provided at deploy time (defaults are empty for safety).

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

### Journal (HTTP API on `{ApiUrl}`)

There is **no auth** on these paths today: the client sends an opaque **`ownerId`** (UUID stored in browser `localStorage`). Treat that ID as a **secret**; anyone who knows it can read or overwrite that owner’s journal data.

**Text and HTML** live in **DynamoDB** (`JournalTable`): one partition key per `ownerId`, sort keys **`META`** (active entry id) and **`ENTRY#<entryId>`** (per-entry `title`, `contentHtml`, timestamps, `listPosition` for ordering). **Voice binaries** use **S3 + CloudFront** only (`POST /journal/voice`), not embedded mega-payloads in DynamoDB.

- **GET** `{ApiUrl}/journal/store?ownerId=<uuid>`  
  Returns JSON `{ "store": JournalStoreV2 | null }` (same shape as before).  
  `JournalStoreV2` is `{ "version": 2, "activeEntryId": string | null, "entries": [...] }` with each entry including `id`, `createdAt`, `updatedAt`, `title`, `contentHtml`.  
  `store` is `null` if nothing exists for that owner. On first read, if a **legacy** S3 object `journal/stores/{ownerId}.json` still exists, the Lambda **migrates** it into DynamoDB and removes the S3 object.

- **PUT** `{ApiUrl}/journal/store`  
  Body: `{ "ownerId": string, "store": JournalStoreV2 }`. Validates shape, enforces **per-entry** `contentHtml` size (under DynamoDB’s 400 KB item limit), max **2000** entries, and a **~6 MB** HTTP body cap. Replaces the owner’s journal in DynamoDB to match the payload (deleted entries are removed server-side).

- **POST** `{ApiUrl}/journal/voice`  
  Body: `{ "ownerId": string, "audioBase64": string, "mimeType"?: string }`. Writes **`journal/voice/{ownerId}/{uuid}.{ext}`** to the **media S3 bucket**. **~8 MB** max decoded audio.  
  Success: `{ "key": string, "url": string }` where `url` is `https://<MediaCloudFrontDomain>/<key>`.

- **POST** `{ApiUrl}/journal/transcribe` (requires **`medimade/OPENAI_API_KEY`**)  
  Whisper transcription for journal recordings; see secret table above.

- **GET** `{ApiUrl}/journal/insights?ownerId=<uuid>`  
  Returns `{ "insights": { ownerId, topics, meta } }` where `topics` includes rolling summaries by topic (for example: `overview`, `emotions`, `stress`, `health`, `relationships`, `identity`, `worldview`, `work`, `projects`, `ideas`, `values`, `habits`, `decisions`, `growth`).

- **POST** `{ApiUrl}/journal/insights`  
  Body: `{ "ownerId": string }`. Runs Claude to update rolling summaries from journal-entry deltas since the last run, persists results in DynamoDB (`JournalInsightsTable`), and returns the updated `{ insights }`.

The web journal UI loads from **localStorage** first, then may **GET** and merge when the cloud copy is newer (or local is a single empty stub). Edits **debounce to PUT** the full store; the server persists **per-entry items** in DynamoDB.

## Destroy

```bash
npx cdk destroy --all --profile mm
```

## Telemetry

The **AWS CDK** may print its own notices. This project no longer uses SST; SST telemetry does not apply.
