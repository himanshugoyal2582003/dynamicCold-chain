import math
import random
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional
from models import ShipmentTelemetry, GPSCoordinates, ShelfLifePredictionResponse

# Product profiles with target temperatures and sensitivity thresholds
PRODUCT_PROFILES = {
    "Pharmaceuticals (mRNA Vaccines)": {
        "target_temp": -20.0,
        "tolerance": 2.0,
        "critical_temp": -15.0,
        "baseline_shelf_life_hours": 720.0,
        "humidity_range": (30.0, 50.0),
        "spoilage_rate_multiplier": 1.5,
    },
    "Dairy (Pasteurized Milk & Cream)": {
        "target_temp": 3.5,
        "tolerance": 1.5,
        "critical_temp": 7.0,
        "baseline_shelf_life_hours": 168.0,
        "humidity_range": (60.0, 75.0),
        "spoilage_rate_multiplier": 1.2,
    },
    "Ice Cream & Frozen Desserts": {
        "target_temp": -18.0,
        "tolerance": 2.5,
        "critical_temp": -12.0,
        "baseline_shelf_life_hours": 2160.0,
        "humidity_range": (40.0, 55.0),
        "spoilage_rate_multiplier": 1.4,
    },
    "Fresh Produce (Exotic Berries)": {
        "target_temp": 2.0,
        "tolerance": 1.0,
        "critical_temp": 6.0,
        "baseline_shelf_life_hours": 96.0,
        "humidity_range": (85.0, 95.0),
        "spoilage_rate_multiplier": 1.8,
    },
    "Frozen Seafood (Tuna & Salmon)": {
        "target_temp": -22.0,
        "tolerance": 2.0,
        "critical_temp": -16.0,
        "baseline_shelf_life_hours": 1440.0,
        "humidity_range": (50.0, 65.0),
        "spoilage_rate_multiplier": 1.3,
    },
}

def resolve_product_profile(product_type: Optional[str]):
    normalized = (product_type or '').strip().lower()
    if product_type in PRODUCT_PROFILES:
        return PRODUCT_PROFILES[product_type]
    if 'vaccine' in normalized or 'pharma' in normalized:
        return PRODUCT_PROFILES['Pharmaceuticals (mRNA Vaccines)']
    if 'dairy' in normalized or 'milk' in normalized:
        return PRODUCT_PROFILES['Dairy (Pasteurized Milk & Cream)']
    if 'ice cream' in normalized or 'frozen dessert' in normalized or 'frozen meat' in normalized or 'poultry' in normalized:
        return PRODUCT_PROFILES['Ice Cream & Frozen Desserts']
    if 'berry' in normalized or 'produce' in normalized:
        return PRODUCT_PROFILES['Fresh Produce (Exotic Berries)']
    if 'seafood' in normalized or 'fish' in normalized:
        return PRODUCT_PROFILES['Frozen Seafood (Tuna & Salmon)']
    return PRODUCT_PROFILES['Dairy (Pasteurized Milk & Cream)']

# Pre-seeded routes (Mathura/NCR logistics corridors)
CORRIDORS = [
    {
        "origin": "Mathura Cold Logistics Terminal",
        "destination": "Central Cold Hub, Gurugram",
        "waypoints": [
            (27.4924, 77.6737),
            (27.8974, 77.5360),
            (28.1487, 77.3260),
            (28.4089, 77.0422),
            (28.4595, 77.0266),
        ],
        "total_distance_km": 142.0,
        "base_duration_hours": 3.5,
    },
    {
        "origin": "Faridabad Pharma Distribution Center",
        "destination": "IGI Airport Cargo Terminal, New Delhi",
        "waypoints": [
            (28.4089, 77.3178),
            (28.4890, 77.2910),
            (28.5355, 77.2410),
            (28.5562, 77.1000),
        ],
        "total_distance_km": 48.0,
        "base_duration_hours": 1.8,
    },
    {
        "origin": "Noida Agri-Cold Facility",
        "destination": "Apex Retail Depot, Jaipur",
        "waypoints": [
            (28.5355, 77.3910),
            (28.4595, 77.0266),
            (27.8974, 76.5360),
            (27.3500, 76.1000),
            (26.9124, 75.7873),
        ],
        "total_distance_km": 285.0,
        "base_duration_hours": 6.2,
    },
]

class TruckSimulator:
    def __init__(self, truck_id: str, plate_number: str, product_type: str, corridor_idx: int = 0):
        self.truck_id = truck_id
        self.plate_number = plate_number
        self.shipment_id = f"SHP-{abs(hash(truck_id)) % 90000 + 10000}"
        self.product_type = product_type
        self.profile = PRODUCT_PROFILES.get(product_type, PRODUCT_PROFILES["Dairy (Pasteurized Milk & Cream)"])
        self.corridor = CORRIDORS[corridor_idx % len(CORRIDORS)]

        # Physical state
        self.target_temp = self.profile["target_temp"]
        self.current_temp = self.target_temp + random.uniform(-0.4, 0.4)
        self.ambient_temp = 32.5  # Outside summer heat
        min_h, max_h = self.profile["humidity_range"]
        self.humidity = random.uniform(min_h, max_h)
        self.refrigeration_status = "OPTIMAL"

        # Trajectory state
        self.progress_pct = random.uniform(10.0, 35.0)
        self.speed_kmh = random.uniform(55.0, 75.0)
        self.door_open = False
        self.anomaly_active: Optional[str] = None
        self.anomaly_end_time = 0.0

        # AI tracking metrics
        self.shelf_life_remaining_hours = self.profile["baseline_shelf_life_hours"] * (1.0 - (self.progress_pct / 100.0) * 0.05)
        self.history: List[Dict] = []

    def configure(self, target_temp: Optional[float] = None, product_type: Optional[str] = None):
        if product_type:
            self.product_type = product_type
            self.profile = resolve_product_profile(product_type)

        if target_temp is not None:
            new_target = float(target_temp)
            if new_target != self.target_temp:
                self.target_temp = new_target
                if not self.anomaly_active:
                    self.current_temp = new_target
                    self.refrigeration_status = 'OPTIMAL'

    def inject_anomaly(self, anomaly_type: str, duration_sec: int = 60, custom_temp: Optional[float] = None):
        if anomaly_type == "reset":
            self.anomaly_active = None
            self.door_open = False
            self.current_temp = self.target_temp
            self.refrigeration_status = "OPTIMAL"
            return

        self.anomaly_active = anomaly_type
        self.anomaly_end_time = time.time() + duration_sec
        if anomaly_type == "door_open":
            self.door_open = True
        elif anomaly_type == "temp_spike":
            self.current_temp = custom_temp if custom_temp is not None else self.target_temp + max(6.0, self.profile["tolerance"] * 3.0)
            self.refrigeration_status = "CRITICAL"
        elif anomaly_type == "compressor_failure":
            self.refrigeration_status = "CRITICAL"
        elif anomaly_type == "rapid_defrost":
            self.refrigeration_status = "DEFROST"

    def update_step(self) -> ShipmentTelemetry:
        now = time.time()

        # Check if anomaly expired
        if self.anomaly_active and now > self.anomaly_end_time:
            self.anomaly_active = None
            self.door_open = False

        # Physical thermal simulation
        thermal_inertia = 0.15
        if self.door_open:
            # Rapid ambient heat infiltration
            self.current_temp += (self.ambient_temp - self.current_temp) * 0.08 + random.uniform(0.2, 0.5)
            self.humidity += (80.0 - self.humidity) * 0.05
            self.refrigeration_status = "WARNING" if self.current_temp < self.profile["critical_temp"] else "CRITICAL"
        elif self.anomaly_active == "compressor_failure":
            # Slow warming towards ambient
            self.current_temp += (self.ambient_temp - self.current_temp) * 0.04
            self.refrigeration_status = "CRITICAL"
        elif self.anomaly_active == "rapid_defrost":
            # Temporary planned warming
            self.current_temp += (self.target_temp + 4.0 - self.current_temp) * 0.1
            self.refrigeration_status = "DEFROST"
        else:
            # Normal closed-loop refrigeration control with slight compressor cycling
            drift = math.sin(now / 15.0) * 0.4
            correction = (self.target_temp - self.current_temp) * thermal_inertia
            self.current_temp += correction + drift * 0.05 + random.uniform(-0.05, 0.05)

            temp_deviation = abs(self.current_temp - self.target_temp)
            if temp_deviation > self.profile["tolerance"] * 2.5:
                self.refrigeration_status = "CRITICAL"
            elif temp_deviation > self.profile["tolerance"] * 1.5:
                self.refrigeration_status = "WARNING"
            else:
                self.refrigeration_status = "OPTIMAL"

        # Humidity natural variance
        min_h, max_h = self.profile["humidity_range"]
        target_h = (min_h + max_h) / 2.0
        self.humidity += (target_h - self.humidity) * 0.05 + random.uniform(-0.5, 0.5)
        self.humidity = max(10.0, min(99.0, self.humidity))

        # Progress along route
        self.progress_pct = min(100.0, self.progress_pct + 0.3)
        if self.progress_pct >= 100.0:
            self.progress_pct = 5.0  # Loop route for continuous simulation

        # Interpolate GPS along corridor waypoints
        pts = self.corridor["waypoints"]
        total_segments = len(pts) - 1
        seg_idx = int((self.progress_pct / 100.0) * total_segments)
        seg_idx = min(seg_idx, total_segments - 1)
        sub_progress = (self.progress_pct / 100.0) * total_segments - seg_idx

        lat1, lng1 = pts[seg_idx]
        lat2, lng2 = pts[seg_idx + 1]
        cur_lat = lat1 + (lat2 - lat1) * sub_progress + random.uniform(-0.0003, 0.0003)
        cur_lng = lng1 + (lng2 - lng1) * sub_progress + random.uniform(-0.0003, 0.0003)

        # Heading angle in degrees
        angle_rad = math.atan2(lng2 - lng1, lat2 - lat1)
        heading_deg = (math.degrees(angle_rad) + 360) % 360

        # Estimated travel time
        rem_distance = self.corridor["total_distance_km"] * (1.0 - (self.progress_pct / 100.0))
        rem_hours = rem_distance / max(30.0, self.speed_kmh)
        rem_hrs_int = int(rem_hours)
        rem_mins = int((rem_hours - rem_hrs_int) * 60)
        eta_str = f"{rem_hrs_int}h {rem_mins}m" if rem_hrs_int > 0 else f"{rem_mins} mins"

        # AI Anomaly Score & Spoilage kinetic calculation (Arrhenius-like rate)
        temp_delta = abs(self.current_temp - self.target_temp)
        if temp_delta > self.profile["tolerance"]:
            spoilage_excess = temp_delta - self.profile["tolerance"]
            spoilage_factor = 1.0 + (spoilage_excess / 2.0) ** 1.8 * self.profile["spoilage_rate_multiplier"]
            self.shelf_life_remaining_hours = max(0.0, self.shelf_life_remaining_hours - (10.0 / 3600.0) * spoilage_factor)
            anomaly_score = min(1.0, max(0.0, (spoilage_excess / self.profile["tolerance"]) * 0.4))
        else:
            self.shelf_life_remaining_hours = max(0.0, self.shelf_life_remaining_hours - (10.0 / 3600.0))
            anomaly_score = 0.05

        if self.door_open or self.anomaly_active == "compressor_failure":
            anomaly_score = max(anomaly_score, 0.85)

        # Risk level categorization
        if anomaly_score >= 0.75 or temp_delta >= self.profile["tolerance"] * 3.0:
            spoilage_risk_level = "CRITICAL"
            alert = f"CRITICAL EXCURSION: Cargo temp {self.current_temp:.1f} C is outside safe range around target {self.target_temp:.1f} C!"
        elif anomaly_score >= 0.4:
            spoilage_risk_level = "HIGH"
            alert = f"Temperature drift warning: {self.current_temp:.1f}°C exceeds target {self.target_temp}°C"
        elif anomaly_score >= 0.2:
            spoilage_risk_level = "MODERATE"
            alert = None
        else:
            spoilage_risk_level = "LOW"
            alert = None

        telemetry = ShipmentTelemetry(
            shipment_id=self.shipment_id,
            truck_id=self.truck_id,
            plate_number=self.plate_number,
            product_type=self.product_type,
            temperature=round(self.current_temp, 2),
            target_temp=round(self.target_temp, 1),
            humidity=round(self.humidity, 1),
            gps_coordinates=GPSCoordinates(
                lat=round(cur_lat, 6),
                lng=round(cur_lng, 6),
                speed_kmh=round(self.speed_kmh + random.uniform(-2, 2), 1),
                heading=round(heading_deg, 1),
            ),
            refrigeration_status=self.refrigeration_status,
            timestamp=datetime.now(timezone.utc).isoformat(),
            destination=self.corridor["destination"],
            origin=self.corridor["origin"],
            estimated_travel_time=eta_str,
            route_progress_pct=round(self.progress_pct, 1),
            door_open=self.door_open,
            anomaly_score=round(anomaly_score, 2),
            spoilage_risk_level=spoilage_risk_level,
            shelf_life_remaining_hours=round(self.shelf_life_remaining_hours, 1),
            alert_message=alert,
        )

        # Keep rolling history (up to 120 datapoints)
        self.history.append(telemetry.model_dump())
        if len(self.history) > 120:
            self.history.pop(0)

        return telemetry


class FleetSimulatorManager:
    def __init__(self):
        self.simulators: Dict[str, TruckSimulator] = {}
        self._initialize_fleet()

    def _initialize_fleet(self):
        fleet_specs = [
            ("DL-01-AX-4821", "DL-01-AX-4821", "Pharmaceuticals (mRNA Vaccines)", 0),
            ("HR-26-BK-9034", "HR-26-BK-9034", "Ice Cream & Frozen Desserts", 1),
            ("MH-04-CZ-1192", "MH-04-CZ-1192", "Dairy (Pasteurized Milk & Cream)", 2),
            ("KA-02-DM-7741", "KA-02-DM-7741", "Frozen Seafood (Tuna & Salmon)", 0),
            ("UP-14-EF-3329", "UP-14-EF-3329", "Fresh Produce (Exotic Berries)", 1),
        ]
        for tid, plate, prod, corr in fleet_specs:
            self.simulators[tid] = TruckSimulator(tid, plate, prod, corr)

    def get_simulator(self, truck_id: str) -> TruckSimulator:
        if truck_id not in self.simulators:
            # Auto-spawn simulator for dynamic truck IDs
            prod_names = list(PRODUCT_PROFILES.keys())
            prod = random.choice(prod_names)
            self.simulators[truck_id] = TruckSimulator(truck_id, truck_id, prod, random.randint(0, 2))
        return self.simulators[truck_id]

    def get_all_truck_ids(self) -> List[str]:
        return list(self.simulators.keys())

    def update_all(self) -> Dict[str, ShipmentTelemetry]:
        results = {}
        for tid, sim in self.simulators.items():
            results[tid] = sim.update_step()
        return results

# Singleton instance
fleet_manager = FleetSimulatorManager()
