"""
PyTorch LSTM Inference Engine for ColdChain:
1. SpoilageLSTM: sequence-based food spoilage risk & remaining shelf-life predictor
   (including good vs. bad environment spoiling-time comparison).
2. InsuranceLSTM: sequence-based dynamic insurance premium predictor anchored to
   the admin-configured base price for each truck.
"""

import os
from collections import deque
from typing import Dict, List, Optional
import numpy as np
import torch

from train_lstm import SpoilageLSTM, InsuranceLSTM, SEQ_LEN
from simulator import resolve_product_profile

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ARTIFACTS_DIR = os.path.join(BASE_DIR, "artifacts")
SPOILAGE_WEIGHTS = os.path.join(ARTIFACTS_DIR, "spoilage_lstm.pt")
INSURANCE_WEIGHTS = os.path.join(ARTIFACTS_DIR, "insurance_lstm.pt")


class ColdChainLSTMEngine:
    def __init__(self):
        self.spoilage_model = SpoilageLSTM()
        self.insurance_model = InsuranceLSTM()
        self.spoilage_loaded = False
        self.insurance_loaded = False
        self.truck_sequences: Dict[str, deque] = {}
        self.truck_ins_sequences: Dict[str, deque] = {}
        self._load_models()

    def _load_models(self):
        if os.path.exists(SPOILAGE_WEIGHTS):
            self.spoilage_model.load_state_dict(
                torch.load(SPOILAGE_WEIGHTS, map_location="cpu", weights_only=True)
            )
            self.spoilage_model.eval()
            self.spoilage_loaded = True
        if os.path.exists(INSURANCE_WEIGHTS):
            self.insurance_model.load_state_dict(
                torch.load(INSURANCE_WEIGHTS, map_location="cpu", weights_only=True)
            )
            self.insurance_model.eval()
            self.insurance_loaded = True

    def _build_padded_sequence(self, buf: deque, step_vec: List[float]) -> torch.Tensor:
        buf.append(step_vec)
        items = list(buf)
        if len(items) < SEQ_LEN:
            pad_count = SEQ_LEN - len(items)
            items = [items[0]] * pad_count + items
        arr = np.array([items[-SEQ_LEN:]], dtype=np.float32)
        return torch.from_numpy(arr)

    def predict_spoilage(
        self,
        truck_key: str,
        product_type: Optional[str],
        temperature: float,
        target_temp: Optional[float],
        humidity: float,
        door_open: bool,
        speed_kmh: float,
    ) -> Dict:
        profile = resolve_product_profile(product_type)
        base_hours = float(profile["baseline_shelf_life_hours"])
        eff_target = float(target_temp if target_temp is not None else profile["target_temp"])
        tolerance = float(profile["tolerance"])
        mult = float(profile["spoilage_rate_multiplier"])

        temp_dev = float(temperature) - eff_target
        abs_dev = abs(temp_dev)

        step_vec = [
            float(np.clip(temp_dev / 25.0, -1.0, 2.0)),
            float(np.clip(abs_dev / 25.0, 0.0, 2.0)),
            float(np.clip(humidity / 100.0, 0.0, 1.0)),
            1.0 if door_open else 0.0,
            float(np.clip(speed_kmh / 100.0, 0.0, 1.5)),
            float(tolerance / 5.0),
            float(base_hours / 2160.0),
            float(mult / 2.0),
        ]

        if truck_key not in self.truck_sequences:
            self.truck_sequences[truck_key] = deque(maxlen=SEQ_LEN)
        seq_tensor = self._build_padded_sequence(self.truck_sequences[truck_key], step_vec)

        if self.spoilage_loaded:
            with torch.no_grad():
                out = self.spoilage_model(seq_tensor)[0].numpy()
            lstm_risk = float(np.clip(out[0], 0.04, 0.99))
            lstm_rsl_ratio = float(np.clip(out[1], 0.02, 1.0))
        else:
            excess = max(0.0, abs_dev - tolerance)
            deg = 1.0 + (excess * 0.45 * mult) + (1.2 if door_open else 0.0)
            lstm_risk = float(np.clip((excess / max(1.0, tolerance * 3.0)) * 0.9 + (0.25 if door_open else 0.0), 0.04, 0.99))
            lstm_rsl_ratio = float(np.clip(1.0 / max(1.0, deg), 0.02, 1.0))

        # Also evaluate counterfactual good vs. bad environment predictions with SpoilageLSTM
        good_step = [0.0, 0.0, float(np.mean(profile["humidity_range"]) / 100.0), 0.0, 0.55, float(tolerance / 5.0), float(base_hours / 2160.0), float(mult / 2.0)]
        bad_step = [float((tolerance * 3.5) / 25.0), float((tolerance * 3.5) / 25.0), 0.92, 1.0, 0.0, float(tolerance / 5.0), float(base_hours / 2160.0), float(mult / 2.0)]
        if self.spoilage_loaded:
            with torch.no_grad():
                good_out = self.spoilage_model(torch.tensor([[good_step] * SEQ_LEN], dtype=torch.float32))[0].numpy()
                bad_out = self.spoilage_model(torch.tensor([[bad_step] * SEQ_LEN], dtype=torch.float32))[0].numpy()
            good_env_rsl = round(max(1.0, base_hours * float(np.clip(good_out[1], 0.05, 1.0))), 1)
            bad_env_rsl = round(max(1.0, base_hours * float(np.clip(bad_out[1], 0.02, 0.6))), 1)
        else:
            good_env_rsl = round(base_hours * 0.96, 1)
            bad_env_rsl = round(max(1.0, base_hours * 0.18), 1)

        # Safety guardrail blended with LSTM output
        temp_excess = max(0.0, abs_dev - tolerance)
        if abs_dev > tolerance * 3.0:
            lstm_risk = max(lstm_risk, 0.85)
        elif abs_dev > tolerance * 2.0:
            lstm_risk = max(lstm_risk, 0.55)
        elif door_open:
            lstm_risk = max(lstm_risk, 0.35)

        spoilage_risk = round(float(np.clip(lstm_risk, 0.04, 0.99)), 2)
        rsl_hours = round(max(1.0, base_hours * lstm_rsl_ratio), 1)
        quality_pct = round(float(np.clip((rsl_hours / base_hours) * 100.0, 2.0, 100.0)), 1)

        if spoilage_risk >= 0.75 or quality_pct < 30.0 or abs_dev >= tolerance * 3.0:
            risk_level = "CRITICAL"
            env_condition = "BAD_CRITICAL"
            route_rec = "CRITICAL SPOILAGE ALERT (LSTM): Rapid thermal excursion! Reroute immediately to nearest cold storage."
            reroute_suggested = True
            nearest_market = "City Cold Storage & Distribution Depot (5.4 km)"
            alert_msg = f"Critical temperature excursion: {temperature:.1f} C differs from target {eff_target:.1f} C."
        elif spoilage_risk >= 0.45 or quality_pct < 60.0 or abs_dev >= tolerance * 2.0:
            risk_level = "HIGH"
            env_condition = "BAD_EXCURSION"
            route_rec = "HIGH RISK (LSTM): Cargo degradation accelerating. Divert to regional wholesale terminal."
            reroute_suggested = True
            nearest_market = "Apex Regional Cold Logistics Hub (14.2 km)"
            alert_msg = f"Temperature {temperature:.1f} C is outside the safe range around target {eff_target:.1f} C."
        elif spoilage_risk >= 0.25 or quality_pct < 80.0 or abs_dev > tolerance or door_open:
            risk_level = "MODERATE"
            env_condition = "MODERATE_DRIFT"
            route_rec = "MODERATE RISK (LSTM): Minor temperature drift. Verify refrigeration unit and prioritize route."
            reroute_suggested = False
            nearest_market = "Sector 12 Cold Warehouse (22.0 km)"
            alert_msg = f"Minor temperature drift from target {eff_target:.1f} C. Monitor sensor telemetry."
        else:
            risk_level = "LOW"
            env_condition = "GOOD_OPTIMAL"
            route_rec = "ROUTE OPTIMAL (LSTM): Cargo quality pristine. Target destination on schedule."
            reroute_suggested = False
            nearest_market = None
            alert_msg = None

        # Also push state into insurance sequence buffer for this truck
        ins_vec = [
            spoilage_risk,
            float(np.clip(abs_dev / 15.0, 0.0, 1.0)),
            1.0 if door_open else 0.0,
            1.0 if abs_dev > 2.0 else 0.0,
            0.0,
            0.2,
            0.2,
        ]
        if truck_key not in self.truck_ins_sequences:
            self.truck_ins_sequences[truck_key] = deque(maxlen=SEQ_LEN)
        self.truck_ins_sequences[truck_key].append(ins_vec)

        return {
            "spoilage_risk": spoilage_risk,
            "spoilage_risk_level": risk_level,
            "shelf_life_remaining_hours": rsl_hours,
            "quality_retention_pct": quality_pct,
            "good_env_rsl_hours": good_env_rsl,
            "bad_env_rsl_hours": bad_env_rsl,
            "environment_condition": env_condition,
            "route_recommendation": route_rec,
            "reroute_suggested": reroute_suggested,
            "nearest_safe_market": nearest_market,
            "alert_message": alert_msg,
            "model_type": "PyTorch-SpoilageLSTM" if self.spoilage_loaded else "Kinetic-Fallback",
        }

    def predict_insurance(
        self,
        truck_id: str,
        base_price: float,
        trip_count: int,
        incident_count: int,
        temp_excursion_count: int,
        avg_temp_deviation: float,
        door_open_incidents: int,
        months_in_service: int,
    ) -> Dict:
        eff_base = max(100.0, float(base_price or 450.0))

        # Construct sequence from historical/aggregate metrics
        avg_risk_est = float(np.clip((avg_temp_deviation / 6.0) + (0.15 if door_open_incidents > 0 else 0.0), 0.05, 0.95))
        step_vec = [
            avg_risk_est,
            float(np.clip(avg_temp_deviation / 15.0, 0.0, 1.0)),
            1.0 if door_open_incidents > 0 else 0.0,
            1.0 if temp_excursion_count > 0 else 0.0,
            float(min(1.0, incident_count / 10.0)),
            float(min(1.0, trip_count / 50.0)),
            float(min(1.0, months_in_service / 36.0)),
        ]

        if truck_id in self.truck_ins_sequences and len(self.truck_ins_sequences[truck_id]) > 0:
            items = list(self.truck_ins_sequences[truck_id])
            # Update aggregate context features on the buffered sequence
            enriched_items = [
                [
                    it[0],
                    it[1],
                    it[2],
                    it[3],
                    step_vec[4],
                    step_vec[5],
                    step_vec[6],
                ]
                for it in items
            ]
            if len(enriched_items) < SEQ_LEN:
                enriched_items = [enriched_items[0]] * (SEQ_LEN - len(enriched_items)) + enriched_items
            seq_tensor = torch.from_numpy(np.array([enriched_items[-SEQ_LEN:]], dtype=np.float32))
        else:
            seq_tensor = torch.from_numpy(np.array([[step_vec] * SEQ_LEN], dtype=np.float32))

        if self.insurance_loaded:
            with torch.no_grad():
                out = self.insurance_model(seq_tensor)[0].numpy()
            risk_score = round(float(np.clip(5.0 + out[0] * 90.0, 5.0, 95.0)), 1)
            multiplier = float(np.clip(0.75 + out[1] * 0.75, 0.78, 1.45))
        else:
            thermal_penalty = (temp_excursion_count * 9.5) + (avg_temp_deviation * 14.0)
            door_penalty = door_open_incidents * 5.0
            incident_penalty = incident_count * 20.0
            safety_credits = min(25.0, (trip_count * 1.5) + (months_in_service * 1.2))
            risk_score = round(float(np.clip(15.0 + thermal_penalty + door_penalty + incident_penalty - safety_credits, 5.0, 95.0)), 1)
            multiplier = 0.90 if risk_score <= 25.0 else (1.0 if risk_score <= 55.0 else 1.25)

        factors: List[Dict[str, str]] = []
        if risk_score <= 28.0:
            discount_pct = round(max(4.0, min(22.0, (1.0 - multiplier) * 100.0 if multiplier < 1.0 else 8.0)), 1)
            current_price = round(eff_base * (1.0 - discount_pct / 100.0), 2)
            price_change_pct = -discount_pct
            risk_tier = "LOW_RISK (Discounted)"
            recommendation = f"InsuranceLSTM: Superior cold-chain integrity. Qualified for a {discount_pct}% monthly safe-carrier discount."
            factors.append({"factor": "LSTM Safe Thermal Sequence", "impact": f"-{round(discount_pct * 0.6, 1)}% Discount"})
            factors.append({"factor": "Consistent Humidity & Door Seal", "impact": f"-{round(discount_pct * 0.4, 1)}% Discount"})
        elif risk_score <= 55.0:
            current_price = round(eff_base, 2)
            price_change_pct = 0.0
            risk_tier = "STANDARD"
            recommendation = "InsuranceLSTM: Standard risk rating. Maintain target temperatures to unlock safe-carrier discounts."
            factors.append({"factor": "Standard Operation Profile", "impact": "Baseline Rate Maintained"})
        else:
            surcharge_pct = round(max(8.0, min(45.0, (multiplier - 1.0) * 100.0 if multiplier > 1.0 else 12.0)), 1)
            current_price = round(eff_base * (1.0 + surcharge_pct / 100.0), 2)
            price_change_pct = surcharge_pct
            risk_tier = "HIGH_RISK (Surcharge)"
            recommendation = f"InsuranceLSTM: Thermal stress & spoilage hazard detected. +{surcharge_pct}% surcharge applied to monthly premium."
            if temp_excursion_count > 0:
                factors.append({"factor": f"{temp_excursion_count} Temperature Excursion(s)", "impact": f"+{round(temp_excursion_count * 6.5, 1)}% Surcharge"})
            if door_open_incidents > 0:
                factors.append({"factor": f"{door_open_incidents} Door Sensor Breach(es)", "impact": f"+{round(door_open_incidents * 4.0, 1)}% Surcharge"})
            if incident_count > 0:
                factors.append({"factor": f"{incident_count} Reported Incident(s)", "impact": f"+{round(incident_count * 12.0, 1)}% Surcharge"})

        adjustment_amount = round(current_price - eff_base, 2)
        return {
            "truck_id": truck_id,
            "base_price": eff_base,
            "current_price": current_price,
            "price_change_pct": price_change_pct,
            "risk_score": risk_score,
            "risk_tier": risk_tier,
            "adjustment_amount": adjustment_amount,
            "recommendation": recommendation,
            "pricing_factors": factors,
            "model_type": "PyTorch-InsuranceLSTM" if self.insurance_loaded else "Rule-Fallback",
        }


lstm_engine = ColdChainLSTMEngine()
