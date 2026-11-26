# ColdChain Backend (NestJS 11 + Socket.IO + Neon Postgres)

NestJS REST API and WebSocket gateway powering authentication/RBAC, 3-role trip dispatch, live GPS tracking, IoT telemetry ingestion, and 1-minute Dual-LSTM snapshot persistence in Neon Postgres (`pg.Pool`).

---

## Local Setup

```powershell
cd backend
npm install
cp .env.example .env   # Configure DATABASE_URL, JWT_SECRET, etc.
npm run db:init        # Initialize tables & demo seed data (optional)
npm run start:dev      # Starts on http://localhost:4000
```

### Scripts
- `npm run build` — Compile TypeScript to `dist/`
- `npm run start:prod` — Run compiled `node dist/main`
- `npm run db:init` — Create tables (and seed demo data if `SEED_DEMO_DATA=true`)
- `npm run db:migrate` — Run schema migrations
- `npm run test:neon` — Verify Neon Postgres, S3 Storage, Auth JWKS, and Functions

---

## Complete AWS CLI Deployment (ECR + AWS App Runner)

> **Prerequisites**: Install [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html), Docker, and run `aws configure`.

### 1. Set Variables
```powershell
$AWS_REGION = "us-east-2"
$AWS_ACCOUNT_ID = (aws sts get-caller-identity --query Account --output text)
$REPO_NAME = "coldchain-backend"
$ECR_URI = "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$REPO_NAME"
```

### 2. Create ECR Repository & Push Container Image
```powershell
aws ecr create-repository --repository-name $REPO_NAME --region $AWS_REGION

aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

# Build & push from backend/
docker build -t $REPO_NAME .
docker tag "${REPO_NAME}:latest" "${ECR_URI}:latest"
docker push "${ECR_URI}:latest"
```

*(If you don't have a `Dockerfile` yet, use `node:20-alpine` with `npm ci && npm run build` and `CMD ["npm", "run", "start:prod"]` exposing port `4000`.)*

### 3. Create IAM Role for App Runner ECR Access
```powershell
aws iam create-role `
  --role-name AppRunnerECRAccessRole `
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"build.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]}'

aws iam attach-role-policy `
  --role-name AppRunnerECRAccessRole `
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess
```

### 4. Deploy Service with `aws apprunner create-service`
```powershell
$ACCESS_ROLE_ARN = "arn:aws:iam::${AWS_ACCOUNT_ID}:role/AppRunnerECRAccessRole"

aws apprunner create-service `
  --region $AWS_REGION `
  --service-name coldchain-backend `
  --source-configuration "{
    \"AuthenticationConfiguration\": { \"AccessRoleArn\": \"$ACCESS_ROLE_ARN\" },
    \"AutoDeploymentsEnabled\": true,
    \"ImageRepository\": {
      \"ImageIdentifier\": \"${ECR_URI}:latest\",
      \"ImageRepositoryType\": \"ECR\",
      \"ImageConfiguration\": {
        \"Port\": \"4000\",
        \"RuntimeEnvironmentVariables\": {
          \"NODE_ENV\": \"production\",
          \"PORT\": \"4000\",
          \"DATABASE_URL\": \"YOUR_NEON_DATABASE_URL\",
          \"JWT_SECRET\": \"YOUR_STRONG_JWT_SECRET\",
          \"IOT_INGEST_SECRET\": \"YOUR_IOT_INGEST_SECRET\",
          \"AIML_SERVICE_TOKEN\": \"YOUR_AIML_SERVICE_TOKEN\",
          \"AI_ML_API_URL\": \"https://YOUR_AIML_SERVICE_URL\",
          \"CORS_ORIGIN\": \"https://YOUR_FRONTEND_URL,https://YOUR_IOT_URL\"
        }
      }
    }
  }" `
  --health-check-configuration "Protocol=HTTP,Path=/api/neon/health,Interval=10,Timeout=5,HealthyThreshold=1,UnhealthyThreshold=5"
```

### 5. Verify Deployment
```powershell
aws apprunner list-services --region $AWS_REGION
# Test health endpoint once Status is RUNNING:
# curl https://<service-url>/api/neon/health
```

---

## Render Deployment
Configured in [`../render.yaml`](../render.yaml) (`rootDir: backend`, health check `/api/neon/health`). See [`../DEPLOYMENT.md`](../DEPLOYMENT.md).
