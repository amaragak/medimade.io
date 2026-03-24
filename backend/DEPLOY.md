# medimade backend (AWS CDK)

SST was removed in favor of the **AWS CDK** so deploys use one consistent toolchain (`aws-cdk` + `aws-cdk-lib`).

## Secret name (AWS Secrets Manager)

Create a secret with this **exact name** (full path string):

| Secret name | Value |
|-------------|--------|
| **`medimade/FISH_AUDIO_API_KEY`** | Your Fish Audio API key (plain text as the secret string) |

Create or update it **before** you exercise the API (stack deploy can succeed even if the secret does not exist yet; the Lambda will fail until the secret is present).

```bash
aws secretsmanager create-secret \
  --name medimade/FISH_AUDIO_API_KEY \
  --secret-string "YOUR_FISH_AUDIO_KEY" \
  --profile mm
```

To rotate:

```bash
aws secretsmanager put-secret-value \
  --secret-id medimade/FISH_AUDIO_API_KEY \
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

After deploy, note **CloudFormation outputs**: `ApiUrl`, `FishTtsUrl`, `FishAudioSecretName`.

## API

- **POST** `{FishTtsUrl}`  
- Body: `{ "text": string, "reference_id": string }`  
- Success: `200`, `audio/mpeg` (base64 in API Gateway)

## Destroy

```bash
npx cdk destroy --all --profile mm
```

## Telemetry

The **AWS CDK** may print its own notices. This project no longer uses SST; SST telemetry does not apply.
