# ColdChain AI/ML Engine (FastAPI + PyTorch Dual-LSTM)

FastAPI inference service running **SpoilageLSTM** (`artifacts/spoilage_lstm.pt`) and **InsuranceLSTM** (`artifacts/insurance_lstm.pt`), plus live telemetry enrichment and route simulation.

---

## Local Setup

```powershell
cd ai-ml
pip install -r requirements.txt
python train_lstm.py   # Optional: regenerate synthetic data & retrain models
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Key Endpoints
- `GET /health` — Service & LSTM model status
- `POST /api/iot/process` — Evaluates `SpoilageLSTM` and forwards to backend `/api/iot/ingest`
- `POST /api/predict/insurance` — Calculates dynamic monthly insurance premium (`₹/mo`)
- `GET /api/trucks/{plate}/telemetry` — Simulated truck telemetry enriched with `SpoilageLSTM`

---

## Complete AWS CLI Deployment (ECR + AWS App Runner)

> **Prerequisites**: Install AWS CLI v2, Docker, and run `aws configure`.

### 1. Set Variables
```powershell
$AWS_REGION = "us-east-2"
$AWS_ACCOUNT_ID = (aws sts get-caller-identity --query Account --output text)
$REPO_NAME = "coldchain-aiml"
$ECR_URI = "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$REPO_NAME"
```

### 2. Create ECR Repository & Push Container Image
```powershell
aws ecr create-repository --repository-name $REPO_NAME --region $AWS_REGION

aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

# Build & push from ai-ml/
docker build -t $REPO_NAME .
docker tag "${REPO_NAME}:latest" "${ECR_URI}:latest"
docker push "${ECR_URI}:latest"
```

*(Container image should use `python:3.10-slim`, `pip install -r requirements.txt`, and `CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]`.)*

### 3. Deploy Service with `aws apprunner create-service`
```powershell
$ACCESS_ROLE_ARN = "arn:aws:iam::${AWS_ACCOUNT_ID}:role/AppRunnerECRAccessRole"

aws apprunner create-service `
  --region $AWS_REGION `
  --service-name coldchain-aiml `
  --instance-configuration "Cpu=1024,Memory=2048" `
  --source-configuration "{
    \"AuthenticationConfiguration\": { \"AccessRoleArn\": \"$ACCESS_ROLE_ARN\" },
    \"AutoDeploymentsEnabled\": true,
    \"ImageRepository\": {
      \"ImageIdentifier\": \"${ECR_URI}:latest\",
      \"ImageRepositoryType\": \"ECR\",
      \"ImageConfiguration\": {
        \"Port\": \"8000\",
        \"RuntimeEnvironmentVariables\": {
          \"BACKEND_API_URL\": \"https://YOUR_BACKEND_SERVICE_URL\",
          \"AIML_SERVICE_TOKEN\": \"YOUR_AIML_SERVICE_TOKEN\",
          \"IOT_INGEST_SECRET\": \"YOUR_IOT_INGEST_SECRET\"
        }
      }
    }
  }" `
  --health-check-configuration "Protocol=HTTP,Path=/health,Interval=10,Timeout=5,HealthyThreshold=1,UnhealthyThreshold=5"
```

### 4. Verify Deployment
```powershell
aws apprunner list-services --region $AWS_REGION
# curl https://<service-url>/health
```

---

## Render Deployment
Configured in [`../render.yaml`](../render.yaml) (`rootDir: ai-ml`, health check `/health`). See [`../DEPLOYMENT.md`](../DEPLOYMENT.md).
