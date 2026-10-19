#!/usr/bin/env bash
# Deploy RMIC Workspace ไป Cloud Run (รันจากโฟลเดอร์ workspace/)
#   PROJECT_ID=my-project REGION=asia-southeast1 ./deploy/deploy.sh
# ครั้งแรกให้สร้าง secret ก่อน (ดู docs/DEPLOY.md ขั้นตอนที่ 3)
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?ตั้ง PROJECT_ID}"
REGION="${REGION:-asia-southeast1}"
SERVICE="${SERVICE:-rmic-workspace}"
SA="${SERVICE_ACCOUNT:-rmic-workspace@${PROJECT_ID}.iam.gserviceaccount.com}"

# อ่านค่าที่ไม่ใช่ความลับจาก .env.production (ถ้ามี) — รูปแบบ KEY=VALUE ต่อบรรทัด
ENV_FILE="${ENV_FILE:-.env.production}"
ENV_VARS=""
if [[ -f "$ENV_FILE" ]]; then
  ENV_VARS=$(grep -vE '^\s*(#|$)' "$ENV_FILE" | sed 's/\s*#.*$//' | grep -vE '^(SESSION_SECRET|ORIGIN_SHARED_SECRET|GOOGLE_OAUTH_CLIENT_SECRET|GOOGLE_OAUTH_REFRESH_TOKEN|LINE_CHANNEL_ACCESS_TOKEN)=' | paste -sd'@' -)
fi

SECRETS="SESSION_SECRET=rmic-session-secret:latest"
for pair in ORIGIN_SHARED_SECRET:rmic-origin-secret GOOGLE_OAUTH_CLIENT_SECRET:rmic-oauth-client-secret GOOGLE_OAUTH_REFRESH_TOKEN:rmic-oauth-refresh-token LINE_CHANNEL_ACCESS_TOKEN:rmic-line-token; do
  name="${pair#*:}"
  if gcloud secrets describe "$name" --project "$PROJECT_ID" >/dev/null 2>&1; then
    SECRETS+=",${pair%%:*}=${name}:latest"
  fi
done

# --max-instances=1: การเขียนชีตใช้ lock ในโปรเซส จึงต้องมี instance เดียว (ผู้ใช้ ~10 คน เพียงพอ)
gcloud run deploy "$SERVICE" \
  --project "$PROJECT_ID" --region "$REGION" --source . \
  --service-account "$SA" \
  --allow-unauthenticated \
  --min-instances 0 --max-instances 1 --concurrency 40 \
  --cpu 1 --memory 512Mi --timeout 120 \
  ${ENV_VARS:+--set-env-vars "^@^${ENV_VARS}"} \
  --set-secrets "$SECRETS"

gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --format 'value(status.url)'
