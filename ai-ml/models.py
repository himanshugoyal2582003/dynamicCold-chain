from pydantic import BaseModel, Field
from typing import Optional, List, Dict
from datetime import datetime

class GPSCoordinates(BaseModel):
    lat: float = Field(..., description="Current latitude")
    lng: float = Field(..., description="Current longitude")
    speed_kmh: float = Field(..., description="Vehicle speed in km/h")
    heading: float = Field(..., description="Heading in degrees (0-360)")

class AnomalyInjectionRequest(BaseModel):
    truck_id: str
    anomaly_type: str = Field(..., description="Options: 'temp_spike', 'door_open', 'compressor_failure', 'rapid_defrost', 'reset'")
    duration_seconds: Optional[int] = 60
    custom_temp: Optional[float] = None

class ShelfLifePredictionRequest(BaseModel):
    product_type: str
    average_temp: float
    max_temp: float
    humidity: float
    transit_duration_hours: float

class ShelfLifePredictionResponse(BaseModel):
    product_type: str
    baseline_shelf_life_hours: float
    predicted_remaining_hours: float
    spoilage_risk_level: str  # LOW, MODERATE, HIGH, CRITICAL
    quality_retention_pct: float
    recommendation: str

class ShipmentTelemetry(BaseModel):
    shipment_id: str
    truck_id: str
    plate_number: str
    product_type: str
    temperature: float
    target_temp: float
    humidity: float
    gps_coordinates: GPSCoordinates
    refrigeration_status: str  # OPTIMAL, DEFROST, WARNING, CRITICAL
    timestamp: str
    destination: str
    estimated_travel_time: str
    origin: str
    route_progress_pct: float
    door_open: bool = False
    anomaly_score: float = 0.0  # 0.0 to 1.0
    spoilage_risk_level: str = "LOW"
    shelf_life_remaining_hours: float
    alert_message: Optional[str] = None

class RawIoTTelemetry(BaseModel):
    device_id: str
    connection_number: str
    truck_id: Optional[str] = None
    plate_number: Optional[str] = None
    device_name: Optional[str] = "ESP32 Sensor Unit"
    product_type: Optional[str] = "Dairy (Pasteurized Milk & Cream)"
    temperature: float
    target_temp: Optional[float] = 4.0
    humidity: float
    battery: Optional[float] = 95.0
    door_open: Optional[bool] = False
    gps_lat: Optional[float] = 19.0760
    gps_lng: Optional[float] = 72.8777
    speed_kmh: Optional[float] = 48.0
    status: Optional[str] = "online"
    timestamp: Optional[str] = None

class ProcessedIoTTelemetry(BaseModel):
    device_id: str
    connection_number: str
    truck_id: Optional[str] = None
    plate_number: Optional[str] = None
    device_name: str
    product_type: str
    temperature: float
    target_temp: float
    humidity: float
    battery: float
    door_open: bool
    gps: Dict[str, float]
    status: str
    spoilage_risk: float  # 0.0 to 1.0
    spoilage_risk_level: str  # LOW, MODERATE, HIGH, CRITICAL
    shelf_life_remaining_hours: float
    quality_retention_pct: float
    route_recommendation: str
    reroute_suggested: bool
    nearest_safe_market: Optional[str] = None
    alert_message: Optional[str] = None
    timestamp: str

class InsurancePricingRequest(BaseModel):
    truck_id: str
    truck_type: Optional[str] = "Refrigerated Semi"
    capacity_tons: Optional[float] = 10.0
    base_price: Optional[float] = 450.0  # Base monthly insurance premium in USD ($)
    trip_count: Optional[int] = 12
    incident_count: Optional[int] = 0
    temp_excursion_count: Optional[int] = 0
    avg_temp_deviation: Optional[float] = 0.2
    door_open_incidents: Optional[int] = 0
    months_in_service: Optional[int] = 6

class InsurancePricingResponse(BaseModel):
    truck_id: str
    base_price: float
    current_price: float
    price_change_pct: float
    risk_score: float  # 0 to 100
    risk_tier: str     # LOW_RISK (Discounted), STANDARD, HIGH_RISK (Surcharge)
    adjustment_amount: float
    recommendation: str
    pricing_factors: List[Dict[str, str]]


