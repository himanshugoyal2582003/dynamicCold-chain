"""
Synthetic Cold-Chain Dataset Generator & Dual PyTorch LSTM Trainer
1. Generates realistic time-series sensor datasets (good, moderate, bad/excursion environments).
2. Trains SpoilageLSTM: predicts spoilage risk & remaining shelf-life retention from sensor sequences.
3. Trains InsuranceLSTM: predicts dynamic insurance risk score & premium multiplier from spoilage/excursion sequences.
"""

import os
import math
import random
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from torch.utils.data import TensorDataset, DataLoader

from simulator import PRODUCT_PROFILES

SEED = 42
random.seed(SEED)
np.random.seed(SEED)
torch.manual_seed(SEED)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
ARTIFACTS_DIR = os.path.join(BASE_DIR, "artifacts")
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(ARTIFACTS_DIR, exist_ok=True)

SEQ_LEN = 12


class SpoilageLSTM(nn.Module):
    def __init__(self, input_size: int = 8, hidden_size: int = 48, num_layers: int = 2):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=0.1,
        )
        self.head = nn.Sequential(
            nn.Linear(hidden_size, 32),
            nn.ReLU(),
            nn.Linear(32, 2),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out, _ = self.lstm(x)
        last_hidden = out[:, -1, :]
        return self.head(last_hidden)


class InsuranceLSTM(nn.Module):
    def __init__(self, input_size: int = 7, hidden_size: int = 32, num_layers: int = 2):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=0.1,
        )
        self.head = nn.Sequential(
            nn.Linear(hidden_size, 24),
            nn.ReLU(),
            nn.Linear(24, 2),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out, _ = self.lstm(x)
        last_hidden = out[:, -1, :]
        return self.head(last_hidden)


def generate_spoilage_dataset(num_sequences: int = 2400):
    profiles = list(PRODUCT_PROFILES.items())
    rows_for_csv = []
    X_list = []
    y_list = []

    scenarios = ["good", "good", "moderate", "bad_spike", "bad_door", "bad_compressor"]

    for seq_id in range(num_sequences):
        prod_name, prof = random.choice(profiles)
        scenario = random.choice(scenarios)
        target_temp = prof["target_temp"]
        tolerance = prof["tolerance"]
        base_hours = prof["baseline_shelf_life_hours"]
        mult = prof["spoilage_rate_multiplier"]
        h_min, h_max = prof["humidity_range"]

        seq_features = []
        cum_degradation = 0.0
        cur_temp = target_temp + np.random.normal(0, 0.25)
        cur_hum = (h_min + h_max) / 2.0

        for t in range(SEQ_LEN):
            door_open = 0.0
            speed = float(np.clip(np.random.normal(58, 10), 0, 95))

            if scenario == "good":
                cur_temp = target_temp + np.random.normal(0, tolerance * 0.25)
                cur_hum = np.clip(cur_hum + np.random.normal(0, 1.0), h_min, h_max)
            elif scenario == "moderate":
                drift = tolerance * np.random.uniform(1.05, 1.8)
                cur_temp = target_temp + drift + np.random.normal(0, 0.3)
                cur_hum = np.clip(cur_hum + np.random.uniform(0.5, 2.0), h_min, min(96.0, h_max + 12))
                if t in (4, 5):
                    door_open = 1.0
            elif scenario == "bad_spike":
                spike = tolerance * np.random.uniform(2.5, 5.5)
                cur_temp = target_temp + spike * ((t + 2) / SEQ_LEN) + np.random.normal(0, 0.4)
                cur_hum = np.clip(cur_hum + np.random.uniform(1.0, 3.0), h_min, 98.0)
            elif scenario == "bad_door":
                door_open = 1.0 if t >= 2 else 0.0
                cur_temp += (18.0 - cur_temp) * (0.12 if door_open else 0.01) + np.random.normal(0, 0.25)
                cur_hum = np.clip(cur_hum + (2.5 if door_open else -0.5), 25.0, 98.0)
                speed = 0.0 if door_open else speed
            else:  # bad_compressor
                cur_temp += (28.0 - cur_temp) * 0.09 + np.random.normal(0, 0.3)
                cur_hum = np.clip(cur_hum + np.random.uniform(0.5, 2.0), 30.0, 98.0)

            temp_dev = cur_temp - target_temp
            abs_dev = abs(temp_dev)
            excess = max(0.0, abs_dev - tolerance)
            step_deg = 1.0 + (excess * 0.45 * mult) + (1.2 if door_open else 0.0)
            cum_degradation += step_deg

            seq_features.append([
                float(np.clip(temp_dev / 25.0, -1.0, 2.0)),
                float(np.clip(abs_dev / 25.0, 0.0, 2.0)),
                float(cur_hum / 100.0),
                float(door_open),
                float(speed / 100.0),
                float(tolerance / 5.0),
                float(base_hours / 2160.0),
                float(mult / 2.0),
            ])

            if seq_id < 250:
                rows_for_csv.append({
                    "sequence_id": seq_id,
                    "minute_step": t + 1,
                    "product_type": prod_name,
                    "scenario": scenario,
                    "temperature": round(float(cur_temp), 2),
                    "target_temp": target_temp,
                    "humidity": round(float(cur_hum), 1),
                    "door_open": bool(door_open),
                    "speed_kmh": round(speed, 1),
                })

        avg_deg = cum_degradation / SEQ_LEN
        last_abs_dev = seq_features[-1][1] * 25.0
        last_door = seq_features[-1][3]
        last_excess = max(0.0, last_abs_dev - tolerance)

        risk_target = (last_excess / max(1.0, tolerance * 3.0)) * 0.85 + (0.25 if last_door else 0.0) + ((avg_deg - 1.0) * 0.08)
        risk_target = float(np.clip(risk_target, 0.04, 0.99))

        rsl_ratio = float(np.clip(1.0 / max(1.0, avg_deg), 0.02, 1.0))

        X_list.append(seq_features)
        y_list.append([risk_target, rsl_ratio])

    df = pd.DataFrame(rows_for_csv)
    df.to_csv(os.path.join(DATA_DIR, "coldchain_sensor_data.csv"), index=False)

    return np.array(X_list, dtype=np.float32), np.array(y_list, dtype=np.float32)


def generate_insurance_dataset(num_sequences: int = 2000):
    rows_for_csv = []
    X_list = []
    y_list = []

    tiers = ["safe", "safe", "standard", "high_risk"]

    for seq_id in range(num_sequences):
        tier = random.choice(tiers)
        incidents = 0 if tier == "safe" else (random.randint(0, 1) if tier == "standard" else random.randint(1, 4))
        trips = random.randint(4, 45) if tier == "safe" else random.randint(1, 25)
        months = random.randint(3, 36)

        seq_features = []
        excursions = 0
        door_events = 0
        total_dev = 0.0

        for t in range(SEQ_LEN):
            if tier == "safe":
                risk = float(np.clip(np.random.normal(0.08, 0.03), 0.04, 0.20))
                abs_dev = float(np.clip(np.random.normal(0.3, 0.2), 0.0, 1.0))
                door = 0.0
            elif tier == "standard":
                risk = float(np.clip(np.random.normal(0.32, 0.10), 0.15, 0.55))
                abs_dev = float(np.clip(np.random.normal(1.4, 0.5), 0.3, 2.8))
                door = 1.0 if random.random() < 0.15 else 0.0
            else:
                risk = float(np.clip(np.random.normal(0.75, 0.15), 0.45, 0.99))
                abs_dev = float(np.clip(np.random.normal(4.5, 1.8), 1.8, 12.0))
                door = 1.0 if random.random() < 0.40 else 0.0

            exc = 1.0 if abs_dev > 2.0 else 0.0
            excursions += int(exc)
            door_events += int(door)
            total_dev += abs_dev

            seq_features.append([
                risk,
                float(np.clip(abs_dev / 15.0, 0.0, 1.0)),
                door,
                exc,
                float(min(1.0, incidents / 10.0)),
                float(min(1.0, trips / 50.0)),
                float(min(1.0, months / 36.0)),
            ])

            if seq_id < 200 and t == SEQ_LEN - 1:
                rows_for_csv.append({
                    "sequence_id": seq_id,
                    "tier": tier,
                    "avg_temp_dev": round(total_dev / SEQ_LEN, 2),
                    "excursions": excursions,
                    "door_events": door_events,
                    "incidents": incidents,
                    "trips": trips,
                    "months_in_service": months,
                })

        avg_dev = total_dev / SEQ_LEN
        thermal_penalty = (excursions * 4.5) + (avg_dev * 12.0)
        door_penalty = door_events * 3.5
        incident_penalty = incidents * 16.0
        safety_credit = min(25.0, (trips * 0.8) + (months * 0.7))

        risk_score = float(np.clip(15.0 + thermal_penalty + door_penalty + incident_penalty - safety_credit, 5.0, 95.0))
        risk_norm = (risk_score - 5.0) / 90.0  # 0..1

        if risk_score <= 28.0:
            discount_pct = min(22.0, 6.0 + (months * 0.4) + (trips * 0.25))
            multiplier = 1.0 - (discount_pct / 100.0)
        elif risk_score <= 55.0:
            multiplier = 1.0
        else:
            surcharge_pct = min(45.0, 10.0 + ((risk_score - 55.0) * 0.85))
            multiplier = 1.0 + (surcharge_pct / 100.0)

        # Normalize multiplier from [0.75, 1.50] to [0, 1]
        mult_norm = float(np.clip((multiplier - 0.75) / 0.75, 0.0, 1.0))

        X_list.append(seq_features)
        y_list.append([risk_norm, mult_norm])

    df = pd.DataFrame(rows_for_csv)
    df.to_csv(os.path.join(DATA_DIR, "coldchain_insurance_data.csv"), index=False)

    return np.array(X_list, dtype=np.float32), np.array(y_list, dtype=np.float32)


def train_model(model: nn.Module, X: np.ndarray, y: np.ndarray, epochs: int = 25, lr: float = 0.003):
    dataset = TensorDataset(torch.from_numpy(X), torch.from_numpy(y))
    loader = DataLoader(dataset, batch_size=64, shuffle=True)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    criterion = nn.MSELoss()

    model.train()
    final_loss = 0.0
    for epoch in range(epochs):
        total_loss = 0.0
        for bx, by in loader:
            optimizer.zero_grad()
            pred = model(bx)
            loss = criterion(pred, by)
            loss.backward()
            optimizer.step()
            total_loss += loss.item() * len(bx)
        final_loss = total_loss / len(dataset)
    return final_loss


if __name__ == "__main__":
    print("Generating synthetic cold-chain sensor dataset...")
    X_sp, y_sp = generate_spoilage_dataset(2400)
    spoilage_model = SpoilageLSTM()
    sp_loss = train_model(spoilage_model, X_sp, y_sp, epochs=25)
    sp_path = os.path.join(ARTIFACTS_DIR, "spoilage_lstm.pt")
    torch.save(spoilage_model.state_dict(), sp_path)
    print(f"Saved SpoilageLSTM -> {sp_path} (final MSE loss: {sp_loss:.5f})")

    print("Generating synthetic insurance underwriting dataset...")
    X_ins, y_ins = generate_insurance_dataset(2000)
    insurance_model = InsuranceLSTM()
    ins_loss = train_model(insurance_model, X_ins, y_ins, epochs=25)
    ins_path = os.path.join(ARTIFACTS_DIR, "insurance_lstm.pt")
    torch.save(insurance_model.state_dict(), ins_path)
    print(f"Saved InsuranceLSTM -> {ins_path} (final MSE loss: {ins_loss:.5f})")
