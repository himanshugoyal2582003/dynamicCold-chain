# ColdChain Production Deployment Guide

This repository deploys cleanly across **Render** (for the two backend services) and **Vercel** or **Netlify** (for the two Next.js frontends).

| Service | Directory | Platform | Default Local Port |
| :--- | :--- | :--- | :--- |
| **Main Backend API** (NestJS + Socket.IO) | `backend/` | **Render** (`render.yaml`) | `:4000` |
| **AI/ML Engine** (FastAPI + PyTorch LSTM) | `ai-ml/` | **Render** (`render.yaml`) | `:8000` |
| **Fleet & Driver Portal** (Next.js 14) | `frontend/` | **Vercel** or **Netlify** | `:3000` |
| **IoT Simulator Portal** (Next.js 14) | `iot/` | **Vercel** or **Netlify** | `:3001` |

---

## 1. Deploy Both Backends on Render

A root Blueprint is provided in [`render.yaml`](./render.yaml) defining both `coldchain-backend` and `coldchain-aiml`.

### Option A — Blueprint Deploy (Recommended)
1. Push your repository to GitHub.
2. In the **Render Dashboard**, click **New → Blueprint** and select this repository.
3. Render detects `render.yaml` and creates both services:
   - **`coldchain-backend`** (`rootDir: backend`)
   - **`coldchain-aiml`** (`rootDir: ai-ml`)

### Option B — Manual Web Services
- **`coldchain-backend`**
  - **Root Directory**: `backend`
  - **Runtime**: Node
  - **Build Command**: `npm ci && npm run build`
  - **Start Command**: `npm run start:prod`
  - **Health Check Path**: `/api/neon/health`
- **`coldchain-aiml`**
  - **Root Directory**: `ai-ml`
  - **Runtime**: Python 3 (`3.10.13`)
  - **Build Command**: `pip install -r requirements.txt`
  - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
  - **Health Check Path**: `/health`

### Required Backend Environment Variables

#### `coldchain-backend`
| Variable | Value / Notes |
| :--- | :--- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Neon Postgres pooled connection string (`?sslmode=require`) |
| `DATABASE_URL_UNPOOLED` | Neon Postgres direct connection string (`?sslmode=require`) |
| `JWT_SECRET` | Strong random secret (auto-generated in `render.yaml`) |
| `IOT_INGEST_SECRET` | Shared secret between `backend`, `ai-ml`, and `iot` |
| `AIML_SERVICE_TOKEN` | Shared secret for `backend` → `ai-ml` requests |
| `AI_ML_API_URL` | Full URL of `coldchain-aiml` (e.g. `https://coldchain-aiml.onrender.com`) |
| `CORS_ORIGIN` | Comma-separated origins of your deployed frontends (no trailing slashes), e.g. `https://coldchain-app.vercel.app,https://coldchain-app.netlify.app,https://coldchain-iot.vercel.app,https://coldchain-iot.netlify.app` |

#### `coldchain-aiml`
| Variable | Value / Notes |
| :--- | :--- |
| `BACKEND_API_URL` | Full URL of `coldchain-backend` (e.g. `https://coldchain-backend.onrender.com`) |
| `AIML_SERVICE_TOKEN` | Must match `coldchain-backend` and `iot` |
| `IOT_INGEST_SECRET` | Must match `coldchain-backend` and `iot` |

> **Note:** Render's `fromService` `host` property injects `hostname` without `https://`. If you use Blueprints, verify `AI_ML_API_URL` and `BACKEND_API_URL` include `https://` in the Render Environment tab.

---

## 2. Deploy Frontends on Vercel

Create **two separate Vercel projects** from the same GitHub repository (configs are already in [`frontend/vercel.json`](./frontend/vercel.json) and [`iot/vercel.json`](./iot/vercel.json)).

### Project 1 — Main Fleet & Driver Portal (`frontend/`)
- **Root Directory**: `frontend`
- **Framework Preset**: Next.js
- **Build Command**: `npm run build`
- **Environment Variables**:
  - `NEXT_PUBLIC_API_URL` = `https://coldchain-backend.onrender.com`

### Project 2 — IoT Hardware Simulator (`iot/`)
- **Root Directory**: `iot`
- **Framework Preset**: Next.js
- **Build Command**: `npm run build`
- **Environment Variables**:
  - `AIML_API_URL` = `https://coldchain-aiml.onrender.com/api/iot/process`
  - `BACKEND_API_URL` = `https://coldchain-backend.onrender.com`
  - `AIML_SERVICE_TOKEN` = *(same secret as `coldchain-aiml`)*
  - `IOT_INGEST_SECRET` = *(same secret as `coldchain-backend`)*

---

## 3. Deploy Frontends on Netlify

Create **two separate Netlify sites** from the same GitHub repository (configs are already in [`frontend/netlify.toml`](./frontend/netlify.toml) and [`iot/netlify.toml`](./iot/netlify.toml)).

### Site 1 — Main Fleet & Driver Portal (`frontend/`)
- **Base directory**: `frontend`
- **Build command**: `npm run build`
- **Publish directory**: `frontend/.next` (handled automatically by `frontend/netlify.toml`)
- **Environment Variables**:
  - `NEXT_PUBLIC_API_URL` = `https://coldchain-backend.onrender.com`

### Site 2 — IoT Hardware Simulator (`iot/`)
- **Base directory**: `iot`
- **Build command**: `npm run build`
- **Publish directory**: `iot/.next` (handled automatically by `iot/netlify.toml`)
- **Environment Variables**:
  - `AIML_API_URL` = `https://coldchain-aiml.onrender.com/api/iot/process`
  - `BACKEND_API_URL` = `https://coldchain-backend.onrender.com`
  - `AIML_SERVICE_TOKEN` = *(same secret as `coldchain-aiml`)*
  - `IOT_INGEST_SECRET` = *(same secret as `coldchain-backend`)*

---

## 4. Post-Deploy Checklist

1. **Initialize Neon DB (first-time only)**:
   ```powershell
   cd backend
   npm run db:init
   ```
   Startup migrations in `IotService` and `TrackingService` also auto-create `iot_devices`, `truck_locations`, `truck_location_history`, and `trip_telemetry_history`.
2. **Verify Backends**:
   - `GET https://coldchain-backend.onrender.com/api/neon/health` → `{"status":"connected",...}`
   - `GET https://coldchain-aiml.onrender.com/health` → `{"status":"ok",...}`
3. **Update `CORS_ORIGIN`** on `coldchain-backend` with your final Vercel & Netlify URLs so browser cookies and Socket.IO WebSockets connect cleanly.
