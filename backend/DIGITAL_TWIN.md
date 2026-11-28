# ColdChain Digital Twin

The Digital Twin compares planned delivery with a user-defined emergency on the same truck and cargo. Admins and fleet owners can open **Digital Twin** from their dashboard navigation. Each run is hypothetical and remains in the response and browser state. It creates no trips, telemetry, assessments, rescue events, routing requests, notifications, or insurance changes. It requires no new database migration, service, environment variable, or model weights.

## Setup and data provenance

Run the existing backend and frontend against a development deployment. Apply the existing schema migrations through 007 to a disposable development database when testing database-backed context. Pair an active truck and use the existing authenticated sensor ingest path. The twin reads the current backend process's telemetry cache, so an instance without the recent reading returns HTTP 409. Select the truck and enter the planned minutes to delivery, outside temperature, assumed remaining shelf life at the configured setpoint, cargo thermal time constant, and cargo value and currency. Event starts are elapsed minutes from the seed. Enter zero duration or zero ambient increase to disable the relevant event. The baseline ends at its planned delivery and the emergency includes the optional delay.

The seed is the reported air temperature. It must come from the current truck connection, with the current setpoint, and have both observation and receipt times within two minutes. The check allows five seconds of clock skew and rejects known simulator identifiers, fallback telemetry, and observations that predate an active trip. Sensor status is based on existing ingest provenance and device identifiers. It cannot independently authenticate physical hardware or verify sensor calibration. The trip supplies the cargo type when in progress. Without an active trip, the sensor's reported product type is used for display. The operator supplies the initial shelf-life assumption in both cases. The LSTMs are outside the simulation loop.

The maintenance panel reads the latest recorded assessment for the same truck, device, connection and setpoint, with a stale flag after 15 minutes. It is inspection context. The scenario event schedule remains an operator input.

The rescue panel reads the first ranked candidate with a recorded road duration on the newest qualifying open, unexpired rescue event for the active trip. It rounds its recorded duration up to elapsed minutes and samples the emergency shelf-life reserve at that minute and after the Rescue Engine's default 15-minute buffer. Values beyond the simulated arrival are unavailable. This is a time comparison using a stored, potentially outdated estimate. It neither calculates a new route nor checks current facility availability, approvals or route feasibility. Missing optional rescue or maintenance tables leave the corresponding context unavailable.

## Thermal and cargo model

The deterministic model version is `thermal-q10-v1`. It uses a one-minute step with an air state and a lagging cargo state. The cargo starts at the air reading as a proxy for unmeasured cargo core temperature.

- Let A represent outside temperature and k represent the air exchange rate per minute. The passive update is A + (T − A) × exp(−k), where T is the current air temperature.
- For available refrigeration, calculate the same exponential step with equilibrium A − P/k, where P = 1.2 °C/min is the effective cooling capacity. P = 0 during a refrigeration failure or power loss. The final air update takes the lesser of passive air temperature and the cooled result floored at setpoint. The system can cool below setpoint passively in a cold environment and has no modeled heater.
- Closed-door k is 1/50 per minute. A refrigeration failure leaves that exchange active. Power loss also stops modeled forced circulation, reducing closed-door k to 1/75. Door opening overrides both coefficients with 1/8. These settings are illustrative, so power loss can warm more slowly than refrigeration failure under the same otherwise closed-door assumptions.
- The cargo moves exponentially toward the mean of the current and next air temperatures, with the user-specified time constant. Cargo is a single lumped state with no heat feedback to air. Outside temperature is piecewise constant, with an optional persistent rise. Timed faults and door events apply over [start, start + duration), and overlapping events can compound.
- Each elapsed minute uses the midpoint cargo temperature C to consume 2^(max(0, C − setpoint) / 10) / 60 equivalent hours of shelf life. The floor at zero prevents below-setpoint temperatures from extending the reserve. Remaining reserve cannot go below zero. The quality index is 100 × remaining / initial reserve, with 100 representing the beginning of the run. The indicator is depleted at zero, low reserve through 25%, and reserve available above 25%.
- Modeled loss is entered value × the fraction of initial reserve consumed, rounded to two decimals. Incremental loss is emergency minus baseline at each scenario's own delivery time. Currency is a display unit with no conversion, and the financial result is an illustrative proportional depreciation estimate.

The model has no field calibration, confidence intervals, product-specific microbial dynamics, freezing damage, humidity, live weather, truck-specific insulation, or staged unloading. The quality index is neither a spoilage probability nor a food safety determination. Estimated financial loss is unsuitable for claims or valuation. Use measured operating data and calibrated product and equipment parameters before relying on forecasts in production decisions.

## API

Both endpoints require the existing session cookie. POST also requires the matching CSRF cookie and header. Access requires a live admin or owner role, and owners see only their active trucks. Responses use `Cache-Control: no-store`.

| Method and path | Purpose |
| --- | --- |
| GET `/api/digital-twin/trucks?page=1` | Returns `trucks` and `hasMore`, 50 active accessible trucks per page |
| POST `/api/digital-twin/trucks/:id/simulate` | Returns `hypothetical: true`, model version, truck and seed provenance, normalized inputs, baseline and emergency series and arrival metrics, incremental loss, and optional recorded context |

The POST expects every field below. Unknown keys and numeric strings are rejected. Integer event starts and durations are measured in minutes. Enabled events must start before emergency arrival, and events in progress when the truck arrives are truncated to the forecast horizon.

| Inputs | Accepted values |
| --- | --- |
| `plannedMinutes`, `delayMinutes` | Integers 1–720 and 0–720 respectively |
| `ambientC`, `ambientRiseC` | −50 through 55 °C and 0 through 30 °C respectively |
| `ambientRiseStart`, `failureStart`, `powerLossStart`, `doorStart` | Integers 0–1439 |
| `failureMinutes`, `powerLossMinutes`, `doorMinutes` | Integers 0–1440 |
| `initialShelfLifeHours` | 0.1–8760 |
| `cargoTimeConstantMinutes` | Integer 5–360 |
| `cargoValue`, `currency` | 0–100,000,000 and three uppercase letters |

The API returns 400 for invalid input, 401 for a missing or invalid session, 403 for disallowed roles or failed CSRF, 404 for inaccessible or inactive trucks, 409 for missing or incompatible sensor seed, and 503 for unavailable database or optional-context query errors other than missing tables. Run `npm run test:digital-twin` from `backend/` for the numerical and HTTP suites. The HTTP suite applies the existing migrations to ephemeral PGlite, uses a controlled telemetry fixture, and checks that simulation runs issue only read queries.
