import asyncio
import logging
import requests
from datetime import datetime
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
from simulator import fleet_manager, PRODUCT_PROFILES

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("coldchain-aiml")

app = FastAPI(
    title="Cold-Chain AI/ML & Telemetry Service",
    description="Real-time simulated telemetry generator and predictive shelf-life service per truck",
    version="1.0.0",
)

# Enable CORS for frontend and Streamlit
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
def get_truck_telemetry(truck_id: str):
    sim = fleet_manager.get_simulator(truck_id)
    latest = sim.update_step()
    return {
        "latest": latest.model_dump(),
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
    profile = PRODUCT_PROFILES.get(req.product_type, PRODUCT_PROFILES["Dairy (Pasteurized Milk & Cream)"])
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
    profile = PRODUCT_PROFILES.get(req.product_type, PRODUCT_PROFILES["Dairy (Pasteurized Milk & Cream)"])
    base_hours = profile["baseline_shelf_life_hours"]
    target_temp = req.target_temp if req.target_temp is not None else profile["target_temp"]
    crit_temp = profile["critical_temp"]

    temp_excess = max(0.0, req.temperature - target_temp)
    peak_excess = max(0.0, req.temperature - crit_temp)

    # Kinetic degradation factor
    degradation_factor = 1.0 + (temp_excess * 0.45) + (peak_excess * 1.5)
    if req.door_open:
        degradation_factor += 1.2

    # Spoilage risk calculation (0.0 to 1.0)
    risk_score = (temp_excess / max(1.0, crit_temp - target_temp)) * 0.65
    if req.door_open:
        risk_score += 0.25
    spoilage_risk = round(max(0.04, min(0.99, risk_score)), 2)

    # Remaining shelf life (hours)
    rsl = max(1.0, round(base_hours / max(1.0, degradation_factor), 1))
    quality_pct = max(2.0, min(100.0, round((rsl / base_hours) * 100.0, 1)))

    # Spoilage risk classification & dynamic route suggestion
    if spoilage_risk >= 0.75 or quality_pct < 30.0:
        risk_level = "CRITICAL"
        route_rec = "CRITICAL SPOILAGE ALERT: Rapid thermal excursion! Reroute immediately to nearest cold storage."
        reroute_suggested = True
        nearest_market = "City Cold Storage & Distribution Depot (5.4 km)"
        alert_msg = f"Critical temperature {req.temperature:.1f}°C detected! Spoilage imminent."
    elif spoilage_risk >= 0.45 or quality_pct < 60.0:
        risk_level = "HIGH"
        route_rec = "HIGH RISK: Cargo degradation accelerating. Divert to regional wholesale terminal."
        reroute_suggested = True
        nearest_market = "Apex Regional Cold Logistics Hub (14.2 km)"
        alert_msg = f"Elevated temperature {req.temperature:.1f}°C exceeds safe threshold."
    elif spoilage_risk >= 0.25 or quality_pct < 80.0:
        risk_level = "MODERATE"
        route_rec = "MODERATE RISK: Minor temperature drift. Verify refrigeration unit and prioritize route."
        reroute_suggested = False
        nearest_market = "Sector 12 Cold Warehouse (22.0 km)"
        alert_msg = "Minor thermal stress. Monitor sensor telemetry."
    else:
        risk_level = "LOW"
        route_rec = "ROUTE OPTIMAL: Cargo quality pristine. Target destination on schedule."
        reroute_suggested = False
        nearest_market = None
        alert_msg = None

    ts = req.timestamp or datetime.utcnow().isoformat() + "Z"

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
            "speed_kmh": req.speed_kmh or 45.0,
        },
        status=req.status or "online",
        spoilage_risk=spoilage_risk,
        spoilage_risk_level=risk_level,
        shelf_life_remaining_hours=rsl,
        quality_retention_pct=quality_pct,
        route_recommendation=route_rec,
        reroute_suggested=reroute_suggested,
        nearest_safe_market=nearest_market,
        alert_message=alert_msg,
        timestamp=ts,
    )

    # Forward to Main Backend (NestJS)
    try:
        requests.post(
            "http://localhost:4000/api/iot/ingest",
            json=processed.model_dump(),
            timeout=2.0,
        )
    except Exception as e:
        logger.debug(f"Could not forward to backend at http://localhost:4000/api/iot/ingest: {e}")

    return processed


# WebSocket connection per truck: sends live telemetry every 10 seconds
@app.websocket("/ws/telemetry/{truck_id}")
async def websocket_telemetry_endpoint(websocket: WebSocket, truck_id: str):
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
