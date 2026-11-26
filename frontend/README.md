# ColdChain Frontend (Next.js 14 — Fleet, Admin, Owner & Driver Portals)

Main web application serving:
- **Enterprise Landing Page (`/`)**: 3D `<TruckHero />`, **ColdChain Sentinel X1** product photo + interactive 3D Three.js model, and a Canvas-rendered map of **4,934** Indian cold-storage warehouses (`public/data/warehouses.json`).
- **Admin Portal (`/admin`)**: Fleet overview, global map, trip dispatch, owner/truck/driver management, insurance pricing (`₹/mo`), and PDF reports.
- **Company / Owner Portal (`/owner`)**: Fleet overview, Trip Management (`/owner/trips`), Live Tracking (`/owner/tracking`), Insurance, and Drivers.
- **Driver Control Panel (`/truck`)**: 4-second live telemetry, `+ Assign Trip`, **Start Trip**, live GPS sharing, and issue reporting.

---

## Local Setup

```powershell
cd frontend
npm install
# Set NEXT_PUBLIC_API_URL=http://localhost:4000 in .env.local
npm run dev   # Starts on http://localhost:3000
```

### Scripts
- `npm run dev` — Start development server on `:3000`
- `npm run build` — Production Next.js build
- `npx tsc --noEmit` — TypeScript check

---

## Complete AWS CLI Deployment (AWS Amplify Hosting)

> **Prerequisites**: Install AWS CLI v2, run `aws configure`, and connect your GitHub repo (or use a GitHub personal access token).

### 1. Create Amplify App
```powershell
$AWS_REGION = "us-east-2"
$GITHUB_REPO = "https://github.com/YOUR_ORG/dynamicCold-chain"
$GITHUB_TOKEN = "YOUR_GITHUB_PAT"
$BACKEND_URL = "https://YOUR_BACKEND_URL"

$APP_ID = (aws amplify create-app `
  --region $AWS_REGION `
  --name coldchain-frontend `
  --repository $GITHUB_REPO `
  --access-token $GITHUB_TOKEN `
  --platform WEB_COMPUTE `
  --environment-variables "AMPLIFY_MONOREPO_APP_ROOT=frontend,NEXT_PUBLIC_API_URL=$BACKEND_URL" `
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
