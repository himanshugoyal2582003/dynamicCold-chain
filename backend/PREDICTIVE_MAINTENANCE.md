# ColdChain Predictive Maintenance Engine

The engine summarizes refrigeration behavior and possible sensor faults so a fleet operator can prioritize inspection. It is separate from the spoilage and insurance LSTMs. It does not estimate failure probability, remaining equipment life, or the condition of any specific component.

## Repository audit and data provenance

The backend already provides manual truck maintenance status, driver issue reporting, fleet management, live IoT telemetry, and trip snapshots. The AI/ML service includes spoilage and insurance LSTMs, and the IoT and Python simulators can inject anomalies. These features remain in place. The ESP32/DHT22 bridge reports temperature and humidity to Firebase. Its existing firmware payload lacks door state and an absolute observation timestamp. To qualify for maintenance analysis, this hardware feed needs an authenticated adapter and a trustworthy observation timestamp.

| Input | Maintenance use |
| --- | --- |
| Reported temperature | Deviation, trend, recovery, spikes, flatline |
| Reported relative humidity | Spikes and joint temperature/humidity flatline |
| Explicitly reported door state | Separate observed door events from closed-door thermal behavior. Missing data stays null. |
| Configured truck temperature target | Reference for deviation and recovery. Separate setpoint regimes. |
| Sensor-reported timestamp, device ID, current truck pairing | Time-series ordering, integrity checks, and sensor-specific history |
| Battery, GPS, speed, spoilage and insurance outputs | Excluded. Some existing paths supply defaults or simulations. |

There are no measurements of compressor operation, vibration, electrical power, ambient conditions, or maintenance outcomes in this model. Equipment failure labels and verified maintenance outcomes are unavailable. Historical `trip_telemetry_history` lacks trustworthy source metadata and can contain simulator output or defaulted fields, so the engine starts its own qualified history and does not backfill that table.

## Deployment and data flow

1. Apply versioned migrations through `007_predictive_maintenance.sql` to the intended database before enabling collection. Use a disposable local PostgreSQL database for development and tests.
2. Configure the existing `IOT_INGEST_SECRET` on the backend and authorized producer, and list independently verified sensor IDs in `MAINTENANCE_SENSOR_IDS` as a comma-separated list. Empty backend settings disable collection. For the AI/ML forwarding path, also configure `AIML_SERVICE_TOKEN` on the AI service and its telemetry producer. The allowlist is an operator trust decision. Identifiers alone cannot prove that a device is physical.
3. The authenticated AI/ML enrichment endpoint forwards raw temperature, humidity, explicitly present door state and the original timestamp when both its AI service token and backend ingest secret are configured. Its public LSTM response shape is unchanged. Existing backend clients can omit the new internal field.
4. The authenticated backend records at most one sample per truck per minute from an allowlisted device and the current connection. Fallback input and the repository's known `SIM-` and `DEV-ESP32-` simulated identifiers are excluded. Observation timestamps must include a timezone and fall within ten minutes in the past or five seconds in the future. Measurements outside the supported temperature or humidity range are rejected.
5. A worker checks every minute for up to 50 eligible trucks per pass and evaluates aligned five-minute endpoints, using observations strictly before the endpoint. It prioritizes unassessed trucks and trucks with the oldest assessments. A truck's latest eligible reading must match its current setpoint. Within each process cycles do not overlap. PostgreSQL uniqueness prevents duplicate assessments when replicas process the same endpoint. The worker caps the baseline to one day per truck/device and does not replay missed assessment endpoints.

Samples and assessments are separate from existing trip and insurance data. Assessment history is scoped to the current owner and includes previously recorded device pairings and setpoints. The fleet view uses the current pairing and setpoint and labels assessments stale when their last reading is older than 15 minutes. The API returns up to 96 assessments and daily aggregates for the last 30 days. The migration does not automatically delete rows. Operators should include both tables in their data retention policy and monitor database growth and background warning logs. Missing migration 007 yields a maintenance-specific API error and leaves existing IoT and LSTM behavior available.

## Feature extraction and detector

The current lookback is 30 minutes. A usable contiguous segment needs at least eight samples spanning 12 minutes. A gap longer than five minutes or setpoint change resets the segment. Features are time-aware using the actual observation timestamps.

- Thermal deviation uses the median absolute error relative to setpoint in observed closed-door samples. The warming trend uses median adjacent closed-door slopes in °C/min.
- A cooling recovery segment starts on an observed open-to-closed transition when temperature is at least 0.75°C above target. Recovery is the reduction in deviation per elapsed minute after at least three minutes of consistently closed readings. A positive value means cooling. Cooling below setpoint receives no additional recovery credit. No qualifying closure produces no recovery feature.
- With fewer than five confirmed closed readings and no reported opening, the engine can score unconditioned thermal behavior with reduced penalties. The UI flags the missing context.
- Abrupt temperature and humidity anomalies require a jump followed by a return toward the prior reading within four minutes. A temperature jump must be at least 3°C and return within 0.7°C. Humidity uses 15 and 4 percentage points respectively. A reported door opening anywhere in the three-reading pattern suppresses the reversal flag. Repeated identical temperature **and** humidity for 15 minutes is a potential sensor flatline.
- A robust historical detector compares each eligible feature with nonoverlapping earlier 30-minute windows from the same truck, device, connection and latest setpoint. It requires at least eight comparable windows per feature. The displayed baseline window count is the largest comparable count among eligible features. It uses a one-sided robust score based on the median and scaled median absolute deviation, with feature-specific scale floors for quantized sensors. Only the strongest historical anomaly can deduct up to 14 points.

Median/MAD is used in place of Isolation Forest because calibration is per sensor, with limited unlabeled history and interpretable per-feature deviations. It can still learn an unhealthy baseline if historical behavior is consistently poor. Fixed engineering penalties remain active to reduce that effect. Thresholds are engineering heuristics that require field validation.

The score starts at 100 and subtracts the rounded, capped contributions in the assessment response. It is floored at zero.

| Factor | Deduction before rounding |
| --- | --- |
| Closed-door deviation | 15 points per °C above 0.8°C, capped at 45 |
| Closed-door warming | 180 times the °C/min above 0.03, capped at 24 |
| Slow post-closure recovery | 140 times the °C/min shortfall below 0.10, capped at 24 |
| Deviation and warming with unknown door state | 10 points per °C above 1.4°C, capped at 24, and 120 times the °C/min above 0.06, capped at 18 |
| Temperature and humidity spikes | 23 and 20 points per spike respectively, capped at 45 and 35 |
| Joint flatline | 22 points at 15 minutes |
| Historical deviation | 4 points per robust z-score unit above 3, capped at 14 across features |

Severity is critical at 50 or below, warning at 51–75, watch at 76–90, and normal at 91–100. An unusable window, or one spent with a reported open door and no qualifying thermal or sensor evidence, returns `insufficient_data` and a null score. The engine never changes truck status, starts a work order, or initiates a diversion.

## Access and dashboard

The **Maintenance** link in the administrator and owner dashboards opens the fleet assessments and truck history. The selected truck shows the score and contributing factors, door-state coverage, sample count, observed recovery and baseline size. History aggregates scored windows and warning or critical windows by UTC day.

Both endpoints use the existing cookie authentication middleware. The service verifies the active user's current database role and truck ownership. Drivers have no access. There are no public assessment write endpoints.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/maintenance?page=1` | Paginated current assessments for active accessible trucks, 50 per page |
| GET | `/api/maintenance/trucks/:truckId/history` | Scoped recent assessments and daily summaries |

## Reproducible tests and synthetic evaluation

From `backend/`, run `npm run test:maintenance`, `npm run evaluate:maintenance`, `npm run test:rescue`, and `node scripts/test-security.cjs`. The maintenance integration suite applies the versioned SQL migrations to ephemeral PostgreSQL via PGlite. From `frontend/`, run `npm run test:api-client` and `npm run build`. From `ai-ml/`, run `python -m unittest -v test_aiml test_simulator test_maintenance_forwarding`.

The deterministic synthetic benchmark uses 48 normal calibration windows and 350 independently seeded held-out windows, each of 30 readings. Each of seven scenarios contains 50 windows. Normal and normal door-recovery windows are negative examples. Warm drift, setpoint offset, slow post-door recovery, spikes and flatlines are injected positive behaviors. A warning or critical score flags a positive for both the full model and its fixed-rules-only comparison. The mean-deviation baseline flags a mean absolute temperature deviation of at least 3°C. ROC-AUC compares continuous scores using the same held-out windows.

| Method | Precision | Recall | F1 | ROC-AUC | TP / FP / TN / FN |
| --- | ---: | ---: | ---: | ---: | --- |
| Thermal + robust MAD | 1.000 | 0.748 | 0.856 | 0.980 | 187 / 0 / 100 / 63 |
| Fixed thermal rules only | 1.000 | 0.408 | 0.580 | 0.974 | 102 / 0 / 100 / 148 |
| Mean-temperature-deviation baseline | 1.000 | 0.108 | 0.195 | 0.750 | 27 / 0 / 100 / 223 |

Detection counts out of 50 were 37 for warm drift, 40 for offset, 20 for slow recovery, 40 for spikes and 50 for flatlines. These results describe the generated scenarios. They do not establish field precision, recall or zero false alarms. Testing with longer recordings, diverse equipment, seasonality, verified repairs and confirmed failure outcomes is required before claiming equipment failure prediction.
