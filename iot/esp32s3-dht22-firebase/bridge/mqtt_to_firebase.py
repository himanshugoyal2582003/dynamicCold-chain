
import os
import json
import time
import math
import logging

import requests
import paho.mqtt.client as mqtt

from dotenv import load_dotenv


# ==========================================
# 1. LOAD ENVIRONMENT CONFIGURATION
# ==========================================

load_dotenv()

FIREBASE_DATABASE_URL = os.getenv(
    "FIREBASE_DATABASE_URL", ""
).strip().rstrip("/")

FIREBASE_AUTH_TOKEN = os.getenv(
    "FIREBASE_AUTH_TOKEN", ""
).strip()

MQTT_HOST = os.getenv("MQTT_HOST", "").strip()

MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))

MQTT_TOPIC = os.getenv(
    "MQTT_TOPIC", "esp32s3/dht22/data"
).strip()

MQTT_CLIENT_ID = os.getenv(
    "MQTT_CLIENT_ID", "python-firebase-bridge"
).strip()

MQTT_KEEPALIVE = int(
    os.getenv("MQTT_KEEPALIVE", "60")
)

REQUEST_TIMEOUT = float(
    os.getenv("REQUEST_TIMEOUT", "10")
)

# Optional excursion thresholds for cold chain safety monitoring
ALERT_MIN_TEMP = float(os.getenv("ALERT_MIN_TEMP", "2.0"))
ALERT_MAX_TEMP = float(os.getenv("ALERT_MAX_TEMP", "8.0"))

# Bridge runtime operational metrics
BRIDGE_METRICS = {
    "received": 0,
    "forwarded": 0,
    "validation_errors": 0,
    "firebase_errors": 0,
    "excursions_detected": 0
}


# ==========================================
# 2. LOGGING CONFIGURATION
# ==========================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)

logger = logging.getLogger(__name__)


# ==========================================
# 3. CONFIGURATION VALIDATION
# ==========================================

def validate_config():

    if not FIREBASE_DATABASE_URL.startswith("https://"):

        raise ValueError(
            "Invalid Firebase Database URL."
        )

    if not MQTT_HOST:

        raise ValueError(
            "MQTT_HOST is missing in .env"
        )

    if not MQTT_TOPIC:

        raise ValueError(
            "MQTT_TOPIC is missing in .env"
        )

    if not 1 <= MQTT_PORT <= 65535:

        raise ValueError(
            "Invalid MQTT port."
        )

    if REQUEST_TIMEOUT <= 0:

        raise ValueError(
            "REQUEST_TIMEOUT must be greater than zero."
        )

    if MQTT_KEEPALIVE <= 0:

        raise ValueError(
            "MQTT_KEEPALIVE must be greater than zero."
        )


# ==========================================
# 4. FIREBASE CONFIGURATION
# ==========================================

FIREBASE_URL = (
    FIREBASE_DATABASE_URL +
    "/sensors/mqtt/esp32s3-dht22.json"
)


# ==========================================
# 5. VALIDATE SENSOR DATA
# ==========================================

def validate_sensor_data(data):

    if not isinstance(data, dict):

        raise ValueError(
            "MQTT message must contain a JSON object."
        )

    if "temperature" not in data:

        raise ValueError(
            "Temperature field is missing."
        )

    if "humidity" not in data:

        raise ValueError(
            "Humidity field is missing."
        )

    temperature = data["temperature"]

    humidity = data["humidity"]

    if isinstance(temperature, bool) or not isinstance(
        temperature, (int, float)
    ):

        raise ValueError(
            "Invalid temperature value."
        )

    if isinstance(humidity, bool) or not isinstance(
        humidity, (int, float)
    ):

        raise ValueError(
            "Invalid humidity value."
        )

    temperature = float(temperature)

    humidity = float(humidity)

    if not math.isfinite(temperature):

        raise ValueError(
            "Temperature must be a finite number."
        )

    if not math.isfinite(humidity):

        raise ValueError(
            "Humidity must be a finite number."
        )

    if not -40 <= temperature <= 80:

        raise ValueError(
            "Temperature is outside DHT22 limits."
        )

    if not 0 <= humidity <= 100:

        raise ValueError(
            "Humidity must be between 0 and 100."
        )

    data["temperature"] = temperature

    data["humidity"] = humidity

    # Cold chain excursion check
    is_excursion = (temperature < ALERT_MIN_TEMP) or (temperature > ALERT_MAX_TEMP)
    data["excursion"] = is_excursion
    if is_excursion:
        BRIDGE_METRICS["excursions_detected"] += 1
        logger.warning(
            "Cold chain temperature breach detected: %.2f C (Safe range: %.1f C - %.1f C)",
            temperature, ALERT_MIN_TEMP, ALERT_MAX_TEMP
        )

    data.setdefault(
        "device", "esp32s3-dht22"
    )

    return data


# ==========================================
# 6. SEND DATA TO FIREBASE
# ==========================================

def send_to_firebase(data):

    try:

        headers = {
            "Content-Type": "application/json"
        }

        params = {}

        # Optional Firebase authentication.

        if FIREBASE_AUTH_TOKEN:

            params["auth"] = FIREBASE_AUTH_TOKEN

        response = requests.put(
            FIREBASE_URL,
            json=data,
            headers=headers,
            params=params,
            timeout=REQUEST_TIMEOUT
        )

        response.raise_for_status()

        logger.info(
            "Firebase upload successful!"
        )

        logger.info(
            "Firebase response: %s",
            response.status_code
        )

        return True

    except requests.exceptions.Timeout:

        logger.error(
            "Firebase request timed out."
        )

    except requests.exceptions.HTTPError as error:

        logger.error(
            "Firebase HTTP error: %s",
            error
        )

        if error.response is not None:

            logger.error(
                "Firebase response: %s",
                error.response.text
            )

    except requests.exceptions.RequestException as error:

        logger.error(
            "Firebase connection error: %s",
            error
        )

    return False


# ==========================================
# 7. MQTT CONNECTION CALLBACK
# ==========================================

def on_connect(
    client,
    userdata,
    flags,
    reason_code,
    properties
):

    if reason_code.is_failure:

        logger.error(
            "MQTT connection failed: %s",
            reason_code
        )

        return

    logger.info(
        "Connected to MQTT broker: %s",
        MQTT_HOST
    )

    # Subscribe after every successful connection.
    # This also restores subscription after reconnecting.

    result, message_id = client.subscribe(
        MQTT_TOPIC,
        qos=1
    )

    if result == mqtt.MQTT_ERR_SUCCESS:

        logger.info(
            "Subscribed to topic: %s",
            MQTT_TOPIC
        )

    else:

        logger.error(
            "MQTT subscription failed: %s",
            result
        )


# ==========================================
# 8. MQTT MESSAGE CALLBACK
# ==========================================

def on_message(client, userdata, message):

    logger.info(
        "Received MQTT message on topic: %s",
        message.topic
    )

    try:

        # Convert MQTT bytes into string.

        payload_string = message.payload.decode(
            "utf-8"
        )

        # Convert JSON string into Python dictionary.

        sensor_data = json.loads(
            payload_string
        )

        # Validate sensor readings.

        sensor_data = validate_sensor_data(
            sensor_data
        )

        logger.info(
            "Temperature: %.2f C",
            sensor_data["temperature"]
        )

        logger.info(
            "Humidity: %.2f %%",
            sensor_data["humidity"]
        )

        # Upload the data to Firebase.

        success = send_to_firebase(
            sensor_data
        )

        if success:

            logger.info(
                "MQTT to Firebase transmission completed."
            )

        else:

            logger.error(
                "MQTT data received but Firebase upload failed."
            )

    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:

        logger.error(
            "Invalid MQTT message: %s",
            error
        )

    except Exception as error:

        logger.exception(
            "Unexpected message processing error: %s",
            error
        )


# ==========================================
# 9. MQTT DISCONNECTION CALLBACK
# ==========================================

def on_disconnect(
    client,
    userdata,
    disconnect_flags,
    reason_code,
    properties
):

    if reason_code.is_failure:

        logger.warning(
            "Unexpected MQTT disconnection: %s",
            reason_code
        )

    else:

        logger.info(
            "MQTT disconnected."
        )


# ==========================================
# 10. CREATE MQTT CLIENT
# ==========================================

def create_mqtt_client():

    client = mqtt.Client(
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
        client_id=MQTT_CLIENT_ID,
        protocol=mqtt.MQTTv311
    )

    client.on_connect = on_connect

    client.on_message = on_message

    client.on_disconnect = on_disconnect

    # Automatic reconnection delay.

    client.reconnect_delay_set(
        min_delay=1,
        max_delay=30
    )

    return client


# ==========================================
# 11. MAIN FUNCTION
# ==========================================

def main():

    validate_config()

    logger.info(
        "========================================"
    )

    logger.info(
        "ESP32-S3 DHT22 MQTT Firebase Bridge"
    )

    logger.info(
        "========================================"
    )

    logger.info(
        "MQTT Host: %s",
        MQTT_HOST
    )

    logger.info(
        "MQTT Port: %s",
        MQTT_PORT
    )

    logger.info(
        "MQTT Topic: %s",
        MQTT_TOPIC
    )

    logger.info(
        "Firebase Path: /sensors/mqtt/esp32s3-dht22"
    )

    client = create_mqtt_client()

    try:

        while True:

            try:

                logger.info(
                    "Connecting to MQTT broker..."
                )

                client.connect(
                    MQTT_HOST,
                    MQTT_PORT,
                    MQTT_KEEPALIVE
                )

                # Maintains MQTT connection and
                # processes incoming messages.

                client.loop_forever()

            except KeyboardInterrupt:

                logger.info(
                    "Stopping MQTT Firebase bridge..."
                )

                break

            except Exception as error:

                logger.error(
                    "MQTT connection error: %s",
                    error
                )

                logger.info(
                    "Retrying connection in 5 seconds..."
                )

                time.sleep(5)

    finally:

        client.disconnect()

        logger.info(
            "Bridge stopped."
        )


# ==========================================
# 12. PROGRAM ENTRY POINT
# ==========================================

if __name__ == "__main__":

    main()
