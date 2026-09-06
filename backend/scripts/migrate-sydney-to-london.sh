#!/usr/bin/env bash
# Copy MedimadeBackend DynamoDB tables + media S3 from Sydney → London.
# Requires both regional stacks already deployed. Does NOT delete Sydney.
#
# Usage:
#   AWS_PROFILE=mm ./backend/scripts/migrate-sydney-to-london.sh
set -euo pipefail

PROFILE="${AWS_PROFILE:-mm}"
SRC_REGION="${SRC_REGION:-ap-southeast-2}"
DST_REGION="${DST_REGION:-eu-west-2}"
STACK="${STACK:-MedimadeBackend}"

echo "==> Mapping tables by CloudFormation logical ID ($SRC_REGION → $DST_REGION)"

map_table() {
  local logical="$1"
  local region="$2"
  AWS_PROFILE="$PROFILE" aws cloudformation describe-stack-resource \
    --stack-name "$STACK" \
    --logical-resource-id "$logical" \
    --region "$region" \
    --query StackResourceDetail.PhysicalResourceId \
    --output text
}

TABLE_LOGICALS=(
  MeditationAnalyticsTableDBD22E65
  JournalTable1E2E182B
  IdeateTable6FC78D26
  JournalInsightsTableE2E5BD37
  SoundCatalogTable9BD8B920
  VoiceAdminTable342E866A
  MeditationListenerMixTable5AAC74E7
  MedimadeUsersTable56DCE6C2
  MedimadeMagicLinkTable4487D1BF
  MeditationJobsTable90250867
)

copy_table() {
  local logical="$1"
  local src dst
  src=$(map_table "$logical" "$SRC_REGION")
  dst=$(map_table "$logical" "$DST_REGION")
  echo "---- $logical"
  echo "    src=$src"
  echo "    dst=$dst"

  python3 - "$src" "$dst" "$SRC_REGION" "$DST_REGION" "$PROFILE" <<'PY'
import json, subprocess, sys, time, tempfile, os

src, dst, src_region, dst_region, profile = sys.argv[1:6]

def aws(args, *, input_text=None):
    return subprocess.check_output(
        ["aws", *args, "--profile", profile],
        text=True,
        input=input_text,
    )

start_key = None
copied = 0
while True:
    scan_cmd = [
        "dynamodb", "scan", "--table-name", src, "--region", src_region,
        "--output", "json",
    ]
    if start_key:
        # Pass start key via file to avoid shell limits
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump(start_key, f)
            key_path = f.name
        try:
            scan_cmd += ["--exclusive-start-key", f"file://{key_path}"]
            page = json.loads(aws(scan_cmd))
        finally:
            os.unlink(key_path)
    else:
        page = json.loads(aws(scan_cmd))
    items = page.get("Items", [])
    for i in range(0, len(items), 25):
        chunk = items[i : i + 25]
        pending = {dst: [{"PutRequest": {"Item": it}} for it in chunk]}
        for attempt in range(10):
            with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
                json.dump(pending, f)
                req_path = f.name
            try:
                out = json.loads(
                    aws(
                        [
                            "dynamodb",
                            "batch-write-item",
                            "--region",
                            dst_region,
                            "--request-items",
                            f"file://{req_path}",
                            "--output",
                            "json",
                        ]
                    )
                )
            finally:
                os.unlink(req_path)
            unprocessed = out.get("UnprocessedItems") or {}
            if not unprocessed:
                break
            pending = unprocessed
            time.sleep(0.25 * (attempt + 1))
        else:
            raise SystemExit(f"Unprocessed items remain for {dst}")
        copied += len(chunk)
        print(f"    … {copied}", flush=True)
    start_key = page.get("LastEvaluatedKey")
    if not start_key:
        break
print(f"    copied {copied} items")
PY
}

for logical in "${TABLE_LOGICALS[@]}"; do
  copy_table "$logical"
done

echo "==> Mapping media buckets"
SRC_BUCKET=$(AWS_PROFILE="$PROFILE" aws cloudformation describe-stacks \
  --stack-name "$STACK" --region "$SRC_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='MediaBucketName'].OutputValue" --output text)
DST_BUCKET=$(AWS_PROFILE="$PROFILE" aws cloudformation describe-stacks \
  --stack-name "$STACK" --region "$DST_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='MediaBucketName'].OutputValue" --output text)
echo "    src=$SRC_BUCKET"
echo "    dst=$DST_BUCKET"

AWS_PROFILE="$PROFILE" aws s3 sync \
  "s3://${SRC_BUCKET}" "s3://${DST_BUCKET}" \
  --source-region "$SRC_REGION" \
  --region "$DST_REGION"

echo "==> Mirror JWT signing secret (keep sessions valid across cutover)"
# CF PhysicalResourceId for Secrets Manager is unreliable here; resolve by name prefix.
SRC_JWT=$(AWS_PROFILE="$PROFILE" aws secretsmanager list-secrets --region "$SRC_REGION" \
  --query "SecretList[?starts_with(Name, 'MedimadeAuthJwtSecret')].ARN | [0]" --output text)
DST_JWT=$(AWS_PROFILE="$PROFILE" aws secretsmanager list-secrets --region "$DST_REGION" \
  --query "SecretList[?starts_with(Name, 'MedimadeAuthJwtSecret')].ARN | [0]" --output text)
if [[ -z "$SRC_JWT" || "$SRC_JWT" == "None" || -z "$DST_JWT" || "$DST_JWT" == "None" ]]; then
  echo "ERROR: could not resolve MedimadeAuthJwtSecret in $SRC_REGION / $DST_REGION" >&2
  exit 1
fi
echo "    src jwt=$SRC_JWT"
echo "    dst jwt=$DST_JWT"
JWT_VAL=$(AWS_PROFILE="$PROFILE" aws secretsmanager get-secret-value \
  --secret-id "$SRC_JWT" --region "$SRC_REGION" --query SecretString --output text)
AWS_PROFILE="$PROFILE" aws secretsmanager put-secret-value \
  --secret-id "$DST_JWT" --secret-string "$JWT_VAL" --region "$DST_REGION" >/dev/null
echo "    jwt secret mirrored"

echo "==> Done. Sydney left intact."
