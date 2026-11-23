# Cold Chain ESP32-S3 & DHT22 Hardware Troubleshooting Guide

This guide provides practical diagnostic procedures for resolving common issues encountered during testing and deployment.

---

## 1. DHT22 Sensor Issues

### Symptom: `Failed to read from DHT sensor!` in Serial Monitor
* **Check Pull-up Resistor**: DHT22 data pin requires a 4.7kΩ to 10kΩ pull-up resistor between `DATA` and `3.3V`/`VCC`. (Some 3-pin breakout modules have this built-in, but bare 4-pin sensors do not).
* **Verify Pin Assignment**: Confirm `DHT_PIN` in `secrets.h` matches the GPIO connected (default GPIO 4). On ESP32-S3, avoid strapping pins (GPIO 0, 45, 46).
* **Sampling Rate Limits**: The DHT22 requires at least 2.0 seconds between consecutive reads. Polling faster than 0.5 Hz causes read timeouts and corrupt CRC checksums.
* **Cable Length & Capacitance**: Cable runs over 1 meter can degrade high-speed 1-wire pulses; use shielded twisted pair or lower baud rate reading routines.

---

## 2. Wi-Fi & Network Connectivity

### Symptom: ESP32 stuck in `Connecting to Wi-Fi... .....` loop
* **2.4 GHz vs 5 GHz**: ESP32-S3 only supports 2.4 GHz Wi-Fi (802.11 b/g/n). Ensure your access point does not enforce 5 GHz-only mode.
* **Captive Portals**: ESP32 cannot negotiate browser-based captive login portals.
* **Power Supply Brownouts**: Wi-Fi radio transmission draws peak currents up to 350-400 mA. A weak USB cable or port can cause sudden brownout resets (`Brownout detector was triggered`).

---

## 3. MQTT Broker Communication

### Symptom: `MQTT Failed: Broker Disconnected` / Error Code -2
* **Error -2 (`MQTT_CONNECT_FAILED`)**: Network subsystem failed to open TCP socket. Check IP address and ensure Mosquitto port 1883 is open in firewall.
* **Error 5 (`MQTT_CONNECT_UNAUTHORIZED`)**: Broker requires credentials, but username/password was omitted.
* **Packet Size Limits**: PubSubClient default buffer is 256 bytes. If the telemetry JSON exceeds 256 bytes, increase `MQTT_MAX_PACKET_SIZE` in the Arduino sketch.

---

## 4. Firebase REST API Connectivity

### Symptom: HTTP 401 Unauthorized or HTTP 404 Not Found
* **Database Rules**: Check Firebase Realtime Database Security Rules (`.read: true`, `.write: true` for testing, or auth token).
* **URL Formatting**: Ensure URL ends with `.json`. (e.g. `https://<PROJECT-ID>-default-rtdb.firebaseio.com/sensors/mqtt/esp32s3-dht22.json`).
* **TLS Memory Allocation**: Ensure ESP32-S3 has enough free heap for TLS handshakes.
