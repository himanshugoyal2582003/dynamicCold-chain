import asyncio
import logging
import os
import secrets
import requests
from datetime import datetime, timezone
from typing import Dict, List, Set, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from models import (
    ShipmentTelemetry,
    AnomalyInjectionRequest,
    ShelfLifePredictionRequest,
    ShelfLifePredictionResponse,
    RawIoTTelemetry,
    ProcessedIoTTelemetry,
    InsurancePricingRequest,
    InsurancePricingResponse,
)
from simulator import fleet_manager, resolve_product_profile
from lstm_engine import lstm_engine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("coldchain-aiml")

app = FastAPI(
    title="Cold-Chain AI/ML & Telemetry Service",
    description="Real-time simulated telemetry generator and predictive shelf-life service per truck",
    version="1.0.0",
)

SERVICE_TOKEN = os.getenv("AIML_SERVICE_TOKEN", "")
BACKEND_INGEST_SECRET = os.getenv("IOT_INGEST_SECRET", "")

def has_valid_service_token(token: str | None) -> bool:
    if not SERVICE_TOKEN:
        return True
    return bool(token) and secrets.compare_digest(token, SERVICE_TOKEN)

@app.middleware("http")
async def require_service_auth(request, call_next):
    # Health checks disclose no fleet data and must remain probeable.
    if request.url.path == "/health":
        return await call_next(request)
    if not has_valid_service_token(request.headers.get("x-service-token")):
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=401, content={"detail": "Service authentication required"})
    return await call_next(request)

# Enable CORS for frontend and Streamlit
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("AIML_CORS_ORIGINS", "http://localhost:3001").split(",")],
    allow_credentials=False,
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type", "x-service-token"],
)

# In-memory connection manager for WebSockets
class ConnectionManager:
    def __init__(self):
        # Maps truck_id -> set of active WebSockets
        self.active_connections: Dict[str, Set[WebSocket]] = {}

    async def connect(self, truck_id: str, websocket: WebSocket):
        await websocket.accept()
        if truck_id not in self.active_connections:
            self.active_connections[truck_id] = set()
        self.active_connections[truck_id].add(websocket)
        logger.info(f"WebSocket client connected for truck {truck_id}. Active: {len(self.active_connections[truck_id])}")

    def disconnect(self, truck_id: str, websocket: WebSocket):
        if truck_id in self.active_connections:
            self.active_connections[truck_id].discard(websocket)
            if not self.active_connections[truck_id]:
                del self.active_connections[truck_id]
        logger.info(f"WebSocket client disconnected for truck {truck_id}")

    async def broadcast_to_truck(self, truck_id: str, data: dict):
        if truck_id in self.active_connections:
            dead_sockets = set()
            for connection in self.active_connections[truck_id]:
                try:
                    await connection.send_json(data)
                except Exception:
                    dead_sockets.add(connection)
            for dead in dead_sockets:
                self.active_connections[truck_id].discard(dead)

manager = ConnectionManager()

# Background task: updates fleet telemetry and broadcasts every 10 seconds
async def background_telemetry_loop():
    logger.info("Background telemetry loop started (10-second interval per truck)")
    while True:
        try:
            for truck_id in fleet_manager.get_all_truck_ids():
                sim = fleet_manager.get_simulator(truck_id)
                telemetry = sim.update_step()
                await manager.broadcast_to_truck(truck_id, telemetry.model_dump())
        except Exception as e:
            logger.error(f"Error in background telemetry loop: {e}")
        await asyncio.sleep(10.0)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(background_telemetry_loop())

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "coldchain-aiml",
        "spoilage_lstm_loaded": lstm_engine.spoilage_loaded,
        "insurance_lstm_loaded": lstm_engine.insurance_loaded,
        "active_trucks": fleet_manager.get_all_truck_ids(),
    }

@app.get("/api/trucks")
def list_trucks():
    trucks = []
    for tid in fleet_manager.get_all_truck_ids():
        sim = fleet_manager.get_simulator(tid)
        trucks.append({
            "truck_id": tid,
            "plate_number": sim.plate_number,
            "shipment_id": sim.shipment_id,
            "product_type": sim.product_type,
            "target_temp": sim.target_temp,
            "current_temp": round(sim.current_temp, 2),
            "refrigeration_status": sim.refrigeration_status,
            "destination": sim.corridor["destination"],
        })
    return {"trucks": trucks}

@app.get("/api/trucks/{truck_id}/telemetry")
def get_truck_telemetry(
    truck_id: str,
    target_temp: Optional[float] = None,
    product_type: Optional[str] = None,
):
    sim = fleet_manager.get_simulator(truck_id)
    sim.configure(target_temp=target_temp, product_type=product_type)
    latest = sim.update_step()
    latest_dict = latest.model_dump()
    lstm_out = lstm_engine.predict_spoilage(
        truck_key=truck_id,
        product_type=latest.product_type,
        temperature=latest.temperature,
        target_temp=latest.target_temp,
        humidity=latest.humidity,
        door_open=latest.door_open,
        speed_kmh=latest.gps_coordinates.speed_kmh,
    )
    latest_dict.update({
        "anomaly_score": lstm_out["spoilage_risk"],
        "spoilage_risk_level": lstm_out["spoilage_risk_level"],
        "shelf_life_remaining_hours": lstm_out["shelf_life_remaining_hours"],
        "quality_retention_pct": lstm_out["quality_retention_pct"],
        "good_env_rsl_hours": lstm_out["good_env_rsl_hours"],
        "bad_env_rsl_hours": lstm_out["bad_env_rsl_hours"],
        "environment_condition": lstm_out["environment_condition"],
        "alert_message": lstm_out["alert_message"] or latest_dict.get("alert_message"),
        "model_type": lstm_out["model_type"],
    })
    return {
        "latest": latest_dict,
        "history": sim.history[-60:],  # Last 60 readings
    }

@app.post("/api/trucks/{truck_id}/inject-anomaly")
def inject_anomaly(truck_id: str, req: AnomalyInjectionRequest):
    sim = fleet_manager.get_simulator(truck_id)
    sim.inject_anomaly(req.anomaly_type, req.duration_seconds or 60, req.custom_temp)
    latest = sim.update_step()
    return {
        "success": True,
        "message": f"Anomaly '{req.anomaly_type}' applied to truck {truck_id}",
        "current_state": latest.model_dump(),
    }

@app.post("/api/predict/shelf-life", response_model=ShelfLifePredictionResponse)
def predict_shelf_life(req: ShelfLifePredictionRequest):
    profile = resolve_product_profile(req.product_type)
    base_hours = profile["baseline_shelf_life_hours"]

    # Kinetic degradation calculation based on temperature excursion
    temp_excess = max(0.0, req.average_temp - profile["target_temp"])
    peak_excess = max(0.0, req.max_temp - profile["critical_temp"])

    degradation_rate = 1.0 + (temp_excess * 0.4) + (peak_excess * 1.2)
    effective_elapsed = req.transit_duration_hours * degradation_rate
    remaining = max(0.0, base_hours - effective_elapsed)

    quality_pct = round(max(0.0, min(100.0, (remaining / base_hours) * 100.0)), 1)

    if quality_pct >= 85.0:
        risk = "LOW"
        rec = "Cargo quality is pristine. Normal delivery priority recommended."
    elif quality_pct >= 60.0:
        risk = "MODERATE"
        rec = "Minor thermal stress detected. Prioritize unloading at arrival dock."
    elif quality_pct >= 30.0:
        risk = "HIGH"
        rec = "Significant degradation. Fast-track quality inspection and rapid cold-store transfer."
    else:
        risk = "CRITICAL"
        rec = "Critical spoilage threshold exceeded. Mandatory lab QA verification before distribution."

    return ShelfLifePredictionResponse(
        product_type=req.product_type,
        baseline_shelf_life_hours=base_hours,
        predicted_remaining_hours=round(remaining, 1),
        spoilage_risk_level=risk,
        quality_retention_pct=quality_pct,
        recommendation=rec,
    )

# --- IoT Telemetry Processing Pipeline ---
# 1. Receives raw IoT telemetry from simulator / ESP32
# 2. Applies AI/ML predictive shelf-life & spoilage risk models
# 3. Forwards enriched telemetry to Main Backend (NestJS)
# 4. Returns processed payload with route recommendations
@app.post("/api/iot/process", response_model=ProcessedIoTTelemetry)
def process_iot_telemetry(req: RawIoTTelemetry):
    profile = resolve_product_profile(req.product_type)
    target_temp = req.target_temp if req.target_temp is not None else profile["target_temp"]
    truck_key = req.truck_id or req.connection_number or req.device_id
    speed = req.speed_kmh if req.speed_kmh is not None else 45.0

    lstm_out = lstm_engine.predict_spoilage(
        truck_key=truck_key,
        product_type=req.product_type,
        temperature=req.temperature,
        target_temp=target_temp,
        humidity=req.humidity,
        door_open=bool(req.door_open),
        speed_kmh=speed,
    )

    ts = req.timestamp or datetime.now(timezone.utc).isoformat()

    processed = ProcessedIoTTelemetry(
        device_id=req.device_id,
        connection_number=req.connection_number,
        truck_id=req.truck_id,
        plate_number=req.plate_number,
        device_name=req.device_name or f"Sensor {req.device_id}",
        product_type=req.product_type or profile.get("name", "Cold Cargo"),
        temperature=round(req.temperature, 2),
        target_temp=round(target_temp, 2),
        humidity=round(req.humidity, 1),
        battery=round(req.battery if req.battery is not None else 92.0, 1),
        door_open=bool(req.door_open),
        gps={
            "lat": req.gps_lat or 19.0760,
            "lng": req.gps_lng or 72.8777,
            "speed_kmh": speed,
        },
        status=req.status or "online",
        spoilage_risk=lstm_out["spoilage_risk"],
        spoilage_risk_level=lstm_out["spoilage_risk_level"],
        shelf_life_remaining_hours=lstm_out["shelf_life_remaining_hours"],
        quality_retention_pct=lstm_out["quality_retention_pct"],
        route_recommendation=lstm_out["route_recommendation"],
        reroute_suggested=lstm_out["reroute_suggested"],
        nearest_safe_market=lstm_out["nearest_safe_market"],
        alert_message=lstm_out["alert_message"],
        good_env_rsl_hours=lstm_out["good_env_rsl_hours"],
        bad_env_rsl_hours=lstm_out["bad_env_rsl_hours"],
        environment_condition=lstm_out["environment_condition"],
        model_type=lstm_out["model_type"],
        timestamp=ts,
    )

    # Forward to Main Backend (NestJS)
    backend_url = os.getenv("BACKEND_API_URL", "http://localhost:4000").rstrip("/")
    try:
        requests.post(
            f"{backend_url}/api/iot/ingest",
            json=processed.model_dump(),
            headers={"x-iot-ingest-secret": BACKEND_INGEST_SECRET},
            timeout=2.0,
        )
    except Exception as e:
        logger.debug(f"Could not forward to backend at {backend_url}/api/iot/ingest: {e}")

    return processed


# --- Dynamic Cold-Chain Insurance Pricing ML Model ---
# Predicts monthly insurance premium adjustments based on real-time cold-chain compliance,
# thermal excursions, door sensor anomalies, and incident records.
@app.post("/api/predict/insurance", response_model=InsurancePricingResponse)
def predict_insurance_pricing(req: InsurancePricingRequest):
    result = lstm_engine.predict_insurance(
        truck_id=req.truck_id,
        base_price=req.base_price or 450.0,
        trip_count=req.trip_count or 12,
        incident_count=req.incident_count or 0,
        temp_excursion_count=req.temp_excursion_count or 0,
        avg_temp_deviation=req.avg_temp_deviation or 0.2,
        door_open_incidents=req.door_open_incidents or 0,
        months_in_service=req.months_in_service or 6,
    )
    return InsurancePricingResponse(**result)



# WebSocket connection per truck: sends live telemetry every 10 seconds
@app.websocket("/ws/telemetry/{truck_id}")
async def websocket_telemetry_endpoint(websocket: WebSocket, truck_id: str):
    if not has_valid_service_token(websocket.headers.get("x-service-token")):
        await websocket.close(code=1008)
        return
    await manager.connect(truck_id, websocket)
    sim = fleet_manager.get_simulator(truck_id)
    try:
        # Send initial snapshot immediately upon connection
        first_payload = sim.update_step()
        await websocket.send_json(first_payload.model_dump())

        # Stream every 10 seconds per truck
        while True:
            await asyncio.sleep(10.0)
            payload = sim.update_step()
            await websocket.send_json(payload.model_dump())
    except WebSocketDisconnect:
        manager.disconnect(truck_id, websocket)
    except Exception as e:
        logger.warning(f"WebSocket connection error for {truck_id}: {e}")
        manager.disconnect(truck_id, websocket)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
