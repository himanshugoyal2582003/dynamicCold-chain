import time
import requests
import os
import pandas as pd
import numpy as np
import plotly.graph_objects as go
import streamlit as st

API_BASE_URL = "http://localhost:8000"
SERVICE_HEADERS = {"x-service-token": os.getenv("AIML_SERVICE_TOKEN", "")}

st.set_page_config(
    page_title="ColdChain AI/ML Fleet Intelligence",
    page_icon="❄️",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Custom luxury CSS styling
st.markdown("""
<style>
    .reportview-container {
        background: #F7F6F3;
    }
    .metric-card {
        background: white;
        border: 1px solid #E3E1DC;
        border-radius: 8px;
        padding: 16px 20px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .status-optimal {
        color: #2E7D5B;
        font-weight: 700;
        background: #E8F5E9;
        padding: 4px 10px;
        border-radius: 4px;
        border: 1px solid #C8E6C9;
    }
    .status-warning {
        color: #C9962B;
        font-weight: 700;
        background: #FFF8E1;
        padding: 4px 10px;
        border-radius: 4px;
        border: 1px solid #FFE082;
    }
    .status-critical {
        color: #A3262A;
        font-weight: 700;
        background: #FFEBEE;
        padding: 4px 10px;
        border-radius: 4px;
        border: 1px solid #FFCDD2;
    }
    .status-defrost {
        color: #2F5D8A;
        font-weight: 700;
        background: #E3F2FD;
        padding: 4px 10px;
        border-radius: 4px;
        border: 1px solid #BBDEFB;
    }
</style>
""", unsafe_allow_html=True)

# Fetch available trucks from FastAPI
@st.cache_data(ttl=5)
def fetch_trucks():
    try:
        res = requests.get(f"{API_BASE_URL}/api/trucks", headers=SERVICE_HEADERS, timeout=3)
        if res.status_code == 200:
            return res.json().get("trucks", [])
    except Exception:
        pass
    return [
        {"truck_id": "DL-01-AX-4821", "plate_number": "DL-01-AX-4821", "product_type": "Pharmaceuticals (mRNA Vaccines)"},
        {"truck_id": "HR-26-BK-9034", "plate_number": "HR-26-BK-9034", "product_type": "Ice Cream & Frozen Desserts"},
        {"truck_id": "MH-04-CZ-1192", "plate_number": "MH-04-CZ-1192", "product_type": "Dairy (Pasteurized Milk & Cream)"},
    ]

# Fetch telemetry for selected truck
def fetch_telemetry(truck_id: str):
    try:
        res = requests.get(f"{API_BASE_URL}/api/trucks/{truck_id}/telemetry", headers=SERVICE_HEADERS, timeout=3)
        if res.status_code == 200:
            return res.json()
    except Exception as e:
        st.error(f"Failed to connect to FastAPI service at {API_BASE_URL}: {e}")
    return None

# Inject anomaly into truck simulator
def inject_anomaly(truck_id: str, anomaly_type: str, custom_temp: float = None):
    try:
        payload = {"truck_id": truck_id, "anomaly_type": anomaly_type, "duration_seconds": 60}
        if custom_temp is not None:
            payload["custom_temp"] = custom_temp
        res = requests.post(f"{API_BASE_URL}/api/trucks/{truck_id}/inject-anomaly", json=payload, headers=SERVICE_HEADERS, timeout=3)
        if res.status_code == 200:
            st.toast(f"✅ Anomaly '{anomaly_type}' successfully applied to {truck_id}!", icon="⚡")
    except Exception as e:
        st.error(f"Error injecting anomaly: {e}")

# ================= SIDEBAR =================
with st.sidebar:
    st.image("https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=300&auto=format&fit=crop&q=80", use_container_width=True)
    st.title("❄️ ColdChain AI/ML")
    st.caption("Real-Time Telemetry & Arrhenius Spoilage Predictor")
    st.divider()

    trucks = fetch_trucks()
    truck_options = [t["truck_id"] for t in trucks]
    selected_truck_id = st.selectbox("Select Active Vehicle", truck_options)

    st.subheader("⚡ Simulation Controls")
    st.write("Inject thermal excursions to test AI anomaly detection:")

    col_btn1, col_btn2 = st.columns(2)
    with col_btn1:
        if st.button("🚨 Temp Spike (+8°C)", use_container_width=True):
            inject_anomaly(selected_truck_id, "temp_spike", custom_temp=8.0)
        if st.button("🚪 Door Open", use_container_width=True):
            inject_anomaly(selected_truck_id, "door_open")
    with col_btn2:
        if st.button("⚠️ Compressor Off", use_container_width=True):
            inject_anomaly(selected_truck_id, "compressor_failure")
        if st.button("🔄 Reset Normal", use_container_width=True):
            inject_anomaly(selected_truck_id, "reset")

    st.divider()
    auto_refresh = st.checkbox("Auto-refresh (every 3s)", value=True)
    if auto_refresh:
        st.caption("Telemetry stream active (WebSocket / 10s cycle)")

# ================= MAIN DASHBOARD =================
data = fetch_telemetry(selected_truck_id)

if data and "latest" in data:
    latest = data["latest"]
    history = data.get("history", [])

    # Status tag formatting
    status = latest["refrigeration_status"]
    status_class = {
        "OPTIMAL": "status-optimal",
        "WARNING": "status-warning",
        "CRITICAL": "status-critical",
        "DEFROST": "status-defrost",
    }.get(status, "status-optimal")

    # Header section
    col_hdr1, col_hdr2 = st.columns([3, 1])
    with col_hdr1:
        st.markdown(f"## 🚚 Vehicle: `{latest['plate_number']}` · Shipment: `{latest['shipment_id']}`")
        st.markdown(f"**Cargo:** `{latest['product_type']}` | **Destination:** `{latest['destination']}` | **ETA:** `{latest['estimated_travel_time']}`")
    with col_hdr2:
        st.markdown(f"<div style='text-align:right; margin-top:10px;'><span class='{status_class}'>REFRIGERATION: {status}</span></div>", unsafe_allow_html=True)
        st.caption(f"Last updated: {latest['timestamp'][:19].replace('T', ' ')} UTC")

    # Alert banner if excursion exists
    if latest.get("alert_message"):
        st.error(f"⚠️ **ACTIVE ANOMALY ALERT:** {latest['alert_message']}")

    st.divider()

    # Metric Cards Row
    m1, m2, m3, m4, m5 = st.columns(5)
    with m1:
        diff = round(latest["temperature"] - latest["target_temp"], 2)
        st.metric(
            label="Cargo Temp",
            value=f"{latest['temperature']} °C",
            delta=f"{diff:+} °C from target",
            delta_color="inverse" if abs(diff) > 1.5 else "normal",
        )
    with m2:
        st.metric(label="Target Temp", value=f"{latest['target_temp']} °C")
    with m3:
        st.metric(label="Humidity", value=f"{latest['humidity']} %")
    with m4:
        st.metric(label="Vehicle Speed", value=f"{latest['gps_coordinates']['speed_kmh']} km/h")
    with m5:
        risk_color = "red" if latest["spoilage_risk_level"] in ["CRITICAL", "HIGH"] else "green"
        st.metric(label="Predicted Shelf Life", value=f"{latest['shelf_life_remaining_hours']} hrs", delta=f"Risk: {latest['spoilage_risk_level']}")

    st.write("")

    # Visualizations Row: Gauge & Time-series
    col_viz1, col_viz2 = st.columns([1, 2])

    with col_viz1:
        st.subheader("🌡️ Cargo Temp Gauge")
        # Plotly Gauge Chart
        fig_gauge = go.Figure(go.Indicator(
            mode="gauge+number+delta",
            value=latest["temperature"],
            domain={'x': [0, 1], 'y': [0, 1]},
            delta={'reference': latest["target_temp"], 'increasing': {'color': "crimson"}, 'decreasing': {'color': "royalblue"}},
            gauge={
                'axis': {'range': [latest["target_temp"] - 10, latest["target_temp"] + 15]},
                'bar': {'color': "#B08D3C"},
                'steps': [
                    {'range': [latest["target_temp"] - 10, latest["target_temp"] + 2], 'color': "#E8F5E9"},
                    {'range': [latest["target_temp"] + 2, latest["target_temp"] + 5], 'color': "#FFF8E1"},
                    {'range': [latest["target_temp"] + 5, latest["target_temp"] + 15], 'color': "#FFEBEE"},
                ],
                'threshold': {
                    'line': {'color': "red", 'width': 3},
                    'thickness': 0.75,
                    'value': latest["target_temp"] + 5,
                }
            }
        ))
        fig_gauge.update_layout(height=260, margin=dict(l=20, r=20, t=30, b=20))
        st.plotly_chart(fig_gauge, use_container_width=True)

    with col_viz2:
        st.subheader("📈 Temperature & Humidity Trajectory")
        if history:
            df = pd.DataFrame(history)
            df["time"] = pd.to_datetime(df["timestamp"])

            fig_line = go.Figure()
            fig_line.add_trace(go.Scatter(
                x=df["time"], y=df["temperature"],
                mode='lines+markers',
                name='Cargo Temp (°C)',
                line=dict(color='#A3262A', width=2),
            ))
            fig_line.add_trace(go.Scatter(
                x=df["time"], y=df["target_temp"],
                mode='lines',
                name='Target Temp (°C)',
                line=dict(color='#B08D3C', width=1.5, dash='dash'),
            ))
            fig_line.add_trace(go.Scatter(
                x=df["time"], y=df["humidity"],
                mode='lines',
                name='Humidity (%)',
                yaxis='y2',
                line=dict(color='#2F5D8A', width=1.5),
            ))

            fig_line.update_layout(
                height=260,
                margin=dict(l=20, r=20, t=30, b=20),
                legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
                yaxis=dict(title="Temperature (°C)"),
                yaxis2=dict(title="Humidity (%)", overlaying='y', side='right'),
            )
            st.plotly_chart(fig_line, use_container_width=True)
        else:
            st.info("Accumulating history readings...")

    st.divider()

    # Lower Row: GPS Map & AI Spoilage Model
    col_map, col_ai = st.columns([1, 1])

    with col_map:
        st.subheader("📍 Live GPS Tracking & Route")
        gps = latest["gps_coordinates"]
        map_data = pd.DataFrame([{
            "lat": gps["lat"],
            "lon": gps["lng"],
        }])
        st.map(map_data, zoom=10)
        st.caption(f"Coordinates: {gps['lat']}° N, {gps['lng']}° E · Speed: {gps['speed_kmh']} km/h · Heading: {gps['heading']}°")

    with col_ai:
        st.subheader("🧠 Arrhenius Kinetic Spoilage Model")
        st.write(f"Predictive quality degradation based on thermal excursion kinetics for **{latest['product_type']}**:")

        # Predict shelf life API call
        try:
            pred_res = requests.post(
                f"{API_BASE_URL}/api/predict/shelf-life",
                json={
                    "product_type": latest["product_type"],
                    "average_temp": latest["temperature"],
                    "max_temp": latest["temperature"] + (2.0 if latest["door_open"] else 0.5),
                    "humidity": latest["humidity"],
                    "transit_duration_hours": 4.5,
                },
                headers=SERVICE_HEADERS,
                timeout=2,
            )
            if pred_res.status_code == 200:
                pred = pred_res.json()
                st.progress(pred["quality_retention_pct"] / 100.0, text=f"Quality Retention: {pred['quality_retention_pct']}%")
                st.markdown(f"**Risk Level:** `{pred['spoilage_risk_level']}`")
                st.markdown(f"**Remaining Shelf Life:** `{pred['predicted_remaining_hours']} hours` (from {pred['baseline_shelf_life_hours']}h baseline)")
                st.info(f"💡 **AI Recommendation:** {pred['recommendation']}")
        except Exception:
            st.warning("Could not reach predictive AI model endpoint.")

        # Raw payload expander
        with st.expander("🔍 Inspect Full Telemetry JSON (10s Cycle)"):
            st.json(latest)

else:
    st.warning(f"Could not load telemetry for truck '{selected_truck_id}'. Ensure the FastAPI telemetry backend is running at {API_BASE_URL}.")

# Auto-refresh loop
if auto_refresh:
    time.sleep(3)
    st.rerun()
