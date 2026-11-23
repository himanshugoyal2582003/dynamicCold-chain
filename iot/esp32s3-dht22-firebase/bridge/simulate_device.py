"""
Cold Chain IoT - ESP32-S3 Device Simulator
Simulates periodic DHT22 telemetry transmission to the MQTT broker for testing.
"""

import os
import sys
import time
import json
import random
import argparse
import paho.mqtt.client as mqtt
from dotenv import load_dotenv

load_dotenv()

MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_TOPIC = os.getenv("MQTT_TOPIC", "esp32s3/dht22/data")


def run_simulator(count: int = 10, interval: float = 2.0, device_id: str = "sim-esp32s3-01"):
    print(f"Connecting simulator to MQTT broker {MQTT_HOST}:{MQTT_PORT}...")
    client = mqtt.Client(client_id=f"sim-{random.randint(1000, 9999)}")

    try:
        client.connect(MQTT_HOST, MQTT_PORT, keepalive=30)
    except Exception as e:
        print(f"Failed to connect to MQTT broker: {e}")
        sys.exit(1)

    print(f"Publishing {count} telemetry packets to topic '{MQTT_TOPIC}'...")

    for i in range(1, count + 1):
        # Generate realistic refrigerated temperatures (2.0°C to 6.0°C) with occasional slight variation
        temp = round(random.uniform(2.5, 5.8), 2)
        humidity = round(random.uniform(55.0, 68.0), 1)

        payload = {
            "device": device_id,
            "temperature": temp,
            "humidity": humidity,
            "rssi": random.randint(-72, -58),
            "free_heap": random.randint(180000, 210000),
            "uptime_ms": i * int(interval * 1000),
            "simulated": True
        }

        payload_str = json.dumps(payload)
        client.publish(MQTT_TOPIC, payload_str, qos=1)
        print(f"[{i}/{count}] Published: {payload_str}")
        time.sleep(interval)

    client.disconnect()
    print("Simulation completed.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cold Chain ESP32-S3 Telemetry Simulator")
    parser.add_argument("--count", type=int, default=10, help="Number of telemetry packets to send")
    parser.add_argument("--interval", type=float, default=2.0, help="Interval between packets in seconds")
    parser.add_argument("--device", type=str, default="sim-esp32s3-01", help="Simulated device identifier")
    args = parser.parse_args()

    run_simulator(count=args.count, interval=args.interval, device_id=args.device)
