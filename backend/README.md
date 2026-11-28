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

## Predictive maintenance

The [Predictive Maintenance Engine](./PREDICTIVE_MAINTENANCE.md) scores thermal and sensor behavior from approved devices and exposes tenant-scoped fleet history. The technical guide documents the migration, sensor provenance, model, and isolated evaluation.

## Cargo rescue

The driver opens **Cargo rescue** on an in-progress trip. An owner or admin can open the same panel in **Trips**. Selecting **Evaluate emergency routes** checks the latest paired sensor reading, LSTM prediction, and GPS fix. At a spoilage risk of 45% or higher, the engine compares up to five listed facilities within 200 km by straight-line distance and records their OSRM road estimates when available.

The facility directory provides names and locations. A manager contacts the selected facility and records confirmation of cargo acceptance, available capacity, and temperature requirements before approving a diversion. The assigned driver explicitly starts the approved diversion with fresh GPS and telemetry. The approval must still have a valid route and enough estimated shelf life to cover the drive plus 15 minutes. Routes expire five minutes after the original GPS fix, and the truck must be within 2 km of that fix when the driver starts. A manager can reject an expired or unsuitable recommendation so the trip can be evaluated again.

When the cargo has been handed over, the driver or a manager records the handoff. A manager can also record a failed diversion. Each decision records the actor, timestamp, and reason in the trip’s rescue history. Keep sensitive personal details out of decision notes because the assigned driver, owner, and admins can read them. The rescue event stores the selected emergency destination separately from the original trip destination. Shipment completion remains a separate action.

### Configuration and limits

- Apply the versioned migrations through `006_cargo_rescue_engine.sql` before serving the rescue endpoints. For local manual testing, point `DATABASE_URL` at a dedicated disposable PostgreSQL database and run `npm run db:migrate` from `backend/`.
- Set `OSRM_BASE_URL` to the origin of an approved OSRM service. This provider receives the truck’s GPS coordinates and the candidate coordinates. When the setting is empty or routing fails, affected candidates display unavailable estimates and cannot be approved. The compiled backend includes the warehouse dataset. `WAREHOUSE_DATA_PATH` can override the file path.
- GPS must report accuracy of 100 m or better and be at most 60 seconds old. The paired sensor’s live LSTM feed must be at most 30 seconds old. The service rejects fallback and simulated input, and rejects predictions produced with a sensor setpoint that disagrees with the configured truck target.
- OSRM driving routes are estimates and the routing profile does not account for live traffic or truck-specific restrictions. The UI displays route geometry from the evaluation. Facility checks and cargo handoffs are recorded human confirmations. LSTM shelf-life estimates are advisory and have not been validated on real-world trips.

### REST API

All endpoints are scoped to the authorized trip. Requests use the existing session cookie, and writes require the CSRF token.

| Method and path | Purpose |
| --- | --- |
| `GET /api/trips/:tripId/rescue` | List events, candidates, and audit decisions |
| `POST /api/trips/:tripId/rescue` | Evaluate live data or return the existing open event |
| `POST /api/trips/:tripId/rescue/:eventId/decisions` | Record a decision with `action` and `reason` |

Owners and admins can submit `APPROVED`, `REJECTED`, or `CANCELLED`. Approval also requires `candidateId`, `facilityVerified: true`, and `facilityConfirmation`. Only the assigned driver can submit `STARTED`. The assigned driver, owner, or admin can submit `COMPLETED` after handoff.

### Reproduce the tests

```powershell
cd backend
npm ci
npm run test:rescue
cd ../frontend
npm ci
npm run test:api-client
npm run build
```

The rescue suite runs the backend build, GPS and telemetry validation, candidate ranking, routing cache and error tests, and the HTTP workflow against ephemeral PostgreSQL through PGlite. It uses fixture telemetry and mocked OSRM responses and requires no database credentials or routing provider.

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
