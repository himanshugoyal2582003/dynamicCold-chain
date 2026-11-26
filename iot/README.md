# ColdChain IoT Simulator Portal (Next.js 14)

Multi-device ESP32 + DHT22 hardware simulator that streams live telemetry every 4 seconds (`autoStream` enabled by default) to the AI/ML service (`POST /api/iot/process`) and syncs its device registry with the NestJS backend (`POST /api/iot/devices/registry-sync`).

---

## Local Setup

```powershell
cd iot
npm install
cp .env.example .env.local   # Configure AIML_API_URL, BACKEND_API_URL, secrets
npm run dev                  # Starts on http://localhost:3001
```

### Environment Variables
| Variable | Local Default | Purpose |
| :--- | :--- | :--- |
| `AIML_API_URL` | `http://localhost:8000/api/iot/process` | AI/ML SpoilageLSTM processing endpoint |
| `BACKEND_API_URL` | `http://localhost:4000` | NestJS backend URL for device registry sync |
| `AIML_SERVICE_TOKEN` | — | Shared token for `ai-ml` |
| `IOT_INGEST_SECRET` | — | Shared secret for `backend` |

---

## Complete AWS CLI Deployment (AWS Amplify Hosting)

> **Prerequisites**: Install AWS CLI v2, run `aws configure`, and connect your GitHub repo.

### 1. Create Amplify App
```powershell
$AWS_REGION = "us-east-2"
$GITHUB_REPO = "https://github.com/YOUR_ORG/dynamicCold-chain"
$GITHUB_TOKEN = "YOUR_GITHUB_PAT"

$APP_ID = (aws amplify create-app `
  --region $AWS_REGION `
  --name coldchain-iot `
  --repository $GITHUB_REPO `
  --access-token $GITHUB_TOKEN `
  --platform WEB_COMPUTE `
  --environment-variables "AMPLIFY_MONOREPO_APP_ROOT=iot,AIML_API_URL=https://YOUR_AIML_URL/api/iot/process,BACKEND_API_URL=https://YOUR_BACKEND_URL,AIML_SERVICE_TOKEN=YOUR_AIML_SERVICE_TOKEN,IOT_INGEST_SECRET=YOUR_IOT_INGEST_SECRET" `
  --query "app.appId" --output text)

echo "Amplify App ID: $APP_ID"
```

### 2. Connect `main` Branch & Trigger Build
```powershell
aws amplify create-branch `
  --region $AWS_REGION `
  --app-id $APP_ID `
  --branch-name main `
  --enable-auto-build

aws amplify start-job `
  --region $AWS_REGION `
  --app-id $APP_ID `
  --branch-name main `
  --job-type RELEASE
```

### 3. Check Deployment Status
```powershell
aws amplify list-jobs --region $AWS_REGION --app-id $APP_ID --branch-name main
```

---

## Vercel & Netlify Deployment
- **Vercel**: [`vercel.json`](./vercel.json)
- **Netlify**: [`netlify.toml`](./netlify.toml)
- Full guide: [`../DEPLOYMENT.md`](../DEPLOYMENT.md)
