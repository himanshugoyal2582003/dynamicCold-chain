"""
Cold Chain Gateway Healthcheck Probe
Checks MQTT broker socket connectivity and Firebase database endpoint reachability.
Exits with code 0 on healthy, 1 on failure.
"""

import os
import sys
import socket
import requests
from dotenv import load_dotenv

load_dotenv()

MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
FIREBASE_DATABASE_URL = os.getenv("FIREBASE_DATABASE_URL", "").rstrip("/")


def check_mqtt_port(host: str, port: int, timeout_sec: float = 3.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout_sec):
            return True
    except (socket.timeout, ConnectionRefusedError, OSError):
        return False


def check_firebase_endpoint(url: str, timeout_sec: float = 5.0) -> bool:
    if not url:
        return True  # Skip if not set in local env check
    try:
        res = requests.get(f"{url}/.json?shallow=true", timeout=timeout_sec)
        return res.status_code in (200, 401, 403)  # Reachable even if protected
    except requests.RequestException:
        return False


def main():
    mqtt_ok = check_mqtt_port(MQTT_HOST, MQTT_PORT)
    fb_ok = check_firebase_endpoint(FIREBASE_DATABASE_URL)

    status_str = f"MQTT ({MQTT_HOST}:{MQTT_PORT}): {'OK' if mqtt_ok else 'FAIL'} | Firebase: {'OK' if fb_ok else 'FAIL'}"
    print(status_str)

    if not (mqtt_ok and fb_ok):
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
