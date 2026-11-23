
# ESP32-S3 DHT22 Firebase Monitoring System

An IoT-based temperature and humidity monitoring system using ESP32-S3, DHT22, Wi-Fi, HTTP, MQTT, Python, and Firebase Realtime Database.

The project collects environmental data using a DHT22 sensor and transfers it to Firebase using two independent communication methods:

1. HTTP: Direct communication between ESP32-S3 and Firebase.
2. MQTT: ESP32-S3 publishes sensor data to an MQTT broker, and a Python bridge forwards it to Firebase using HTTP.

---

## 1. Project Overview

This project demonstrates how to collect sensor data using an ESP32-S3 and transmit it to a cloud database through HTTP and MQTT protocols.

The system measures:

- Temperature (°C)
- Relative Humidity (%)

Sensor readings are collected every 5 seconds.

The collected data is converted into JSON format and transmitted through both communication pipelines.

### Key Features

- ESP32-S3 Wi-Fi connectivity
- DHT22 temperature and humidity monitoring
- Direct HTTP communication with Firebase
- MQTT-based communication using Mosquitto
- Python MQTT-to-Firebase bridge
- Firebase Realtime Database integration
- Automatic Wi-Fi reconnection
- MQTT reconnection handling
- JSON-based sensor data transmission
- Separate Firebase paths for HTTP and MQTT data

---

## 2. Project Architecture

### HTTP Communication

ESP32-S3 → Wi-Fi → Firebase REST API → Firebase Realtime Database

The ESP32-S3 sends sensor readings directly to Firebase using HTTPS PUT requests.

### MQTT Communication

ESP32-S3 → Wi-Fi → Mosquitto MQTT Broker → Python MQTT Subscriber → Firebase REST API → Firebase Realtime Database

The ESP32-S3 publishes sensor readings to an MQTT topic.

The Python bridge subscribes to that topic, receives the JSON messages, validates the readings, and forwards them to Firebase using HTTP.

### Architecture Diagram

                    ESP32-S3
                        |
                      DHT22
                        |
                    Wi-Fi
                   /     \
                HTTP     MQTT
                 |        |
              Firebase  Mosquitto
                          |
                     Python Bridge
                          |
                     Firebase
                          |
                   Realtime Database

---

## 3. Hardware Requirements

| Component | Purpose |
|---|---|
| ESP32-S3 Development Board | Main microcontroller |
| DHT22 Sensor | Temperature and humidity measurement |
| Breadboard | Circuit connections |
| Jumper Wires | Hardware connections |
| USB Cable | Programming and power |

---

## 4. Hardware Connections

Connect the DHT22 sensor to the ESP32-S3.

| ESP32-S3 Pin | DHT22 Pin | Description |
|---|---|---|
| 3.3V | VCC | Power supply |
| GPIO 4 | DATA | Sensor data |
| GND | GND | Ground |

For a bare four-pin DHT22, connect a 4.7kΩ–10kΩ pull-up resistor between DATA and 3.3V.

Leave the NC pin unconnected.

Refer to:

`docs/wiring_diagram.png`

---

## 5. Software Requirements

### Firmware Development

- Arduino IDE
- ESP32 Board Package
- Adafruit DHT Sensor Library
- Adafruit Unified Sensor Library
- PubSubClient Library

### MQTT Communication

- Mosquitto MQTT Broker

### Python Bridge

- Python 3
- Paho MQTT
- Requests
- Python Dotenv

### Cloud Database

- Firebase Realtime Database

---

## 6. Arduino IDE Setup

### Step 1: Install Arduino IDE

Download Arduino IDE:

https://www.arduino.cc/en/software

### Step 2: Install ESP32 Board Package

Open Arduino IDE.

Navigate to:

File → Preferences

Add the following URL to Additional Boards Manager URLs:

https://espressif.github.io/arduino-esp32/package_esp32_index.json

Then navigate to:

Tools → Board → Boards Manager

Search for ESP32 and install the Espressif Systems package.

### Step 3: Install Required Libraries

Open:

Sketch → Include Library → Manage Libraries

Install:

1. DHT sensor library by Adafruit
2. Adafruit Unified Sensor
3. PubSubClient by Nick O'Leary

### Step 4: Select Board

Select your ESP32-S3 board from:

Tools → Board → ESP32 Arduino

Select the correct USB port.

---

## 7. Firebase Setup

### Step 1: Create Firebase Project

Open:

https://console.firebase.google.com/

Create a new Firebase project.

### Step 2: Create Realtime Database

Navigate to:

Build → Realtime Database → Create Database

Choose your database region.

### Step 3: Copy Database URL

Copy the Realtime Database URL.

It will look similar to:

https://your-project-default-rtdb.firebaseio.com

### Step 4: Configure Firebase

Open:

`firmware/esp32s3_dht22_firebase/secrets.h`

Set:

#define FIREBASE_DATABASE_URL "YOUR_FIREBASE_DATABASE_URL"

The Python bridge uses the same database URL in:

`bridge/.env`

### Step 5: Database Rules

The current ESP32 HTTP firmware does not implement Firebase authentication.

For initial testing, Firebase's test mode can allow unauthenticated access. This is only for temporary development.

Do not leave publicly writable database rules enabled on a deployed system.

The Python bridge supports an optional Firebase ID token through FIREBASE_AUTH_TOKEN, but the ESP32 firmware must also be updated to authenticate before using restrictive database rules for both pipelines.

---

## 8. MQTT Broker Setup

This project uses Mosquitto as the MQTT broker.

Download:

https://mosquitto.org/download/

Install Mosquitto on your computer.

### Configure Mosquitto

For local-network testing, configure Mosquitto to accept connections from the ESP32-S3.

A basic configuration is:

```conf
listener 1883 0.0.0.0
allow_anonymous true
```

This is an unauthenticated development configuration. Use MQTT authentication and TLS for production.

Start the broker with the appropriate configuration file.

On Windows, an example command is:

```bash
mosquitto -c "C:\Program Files\mosquitto\mosquitto.conf" -v
```

On Linux:

```bash
sudo mosquitto -c /etc/mosquitto/mosquitto.conf -v
```

Allow incoming TCP traffic on port 1883 through your computer's firewall for your trusted local network.

### Find Your Computer's IP Address

On Windows:

```bash
ipconfig
```

Find the IPv4 Address under your active Wi-Fi adapter.

Example:

192.168.1.100

Use your actual IP address in both:

- `firmware/esp32s3_dht22_firebase/secrets.h`
- `bridge/.env`

Both ESP32-S3 and your computer must be connected to the same local network.

---

## 9. Firmware Configuration

Open:

`firmware/esp32s3_dht22_firebase/secrets.h`

Configure:

```cpp
#define WIFI_SSID "YOUR_WIFI_NAME"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

#define FIREBASE_DATABASE_URL "YOUR_FIREBASE_URL"

#define MQTT_BROKER "192.168.1.100"
#define MQTT_PORT 1883

#define MQTT_TOPIC "esp32s3/dht22/data"
#define MQTT_CLIENT_ID "ESP32S3_DHT22_CLIENT"

#define DHT_PIN 4
#define DHT_TYPE DHT22

#define SENSOR_INTERVAL 5000UL
```

Replace the example configuration with your actual credentials and IP address.

Do not commit `secrets.h` to GitHub.

---

## 10. Python Bridge Setup

Navigate to the bridge directory.

### Step 1: Create Virtual Environment

Windows:

```bash
python -m venv .venv
```

Activate:

```bash
.venv\Scripts\activate
```

Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### Step 2: Install Dependencies

```bash
pip install -r requirements.txt
```

### Step 3: Configure Environment Variables

Create `.env` inside the bridge folder.

Configure:

```env
FIREBASE_DATABASE_URL=https://YOUR-PROJECT-default-rtdb.firebaseio.com

FIREBASE_AUTH_TOKEN=

MQTT_HOST=192.168.1.100
MQTT_PORT=1883

MQTT_TOPIC=esp32s3/dht22/data

MQTT_CLIENT_ID=python-firebase-bridge

MQTT_KEEPALIVE=60

REQUEST_TIMEOUT=10
```

Replace the Firebase URL and MQTT IP with your actual values.

### Step 4: Start Python Bridge

From the bridge directory, run:

```bash
python mqtt_to_firebase.py
```

The script will connect to the MQTT broker and subscribe to the configured topic.

---

## 11. Upload ESP32-S3 Firmware

Open:

`firmware/esp32s3_dht22_firebase/esp32s3_dht22_firebase.ino`

Check that:

- Wi-Fi credentials are correct.
- Firebase database URL is correct.
- MQTT broker IP is correct.
- DHT22 is connected to GPIO 4.

Select your ESP32-S3 board and port.

Upload the firmware.

Open Serial Monitor at:

115200 baud

The board will attempt to connect to Wi-Fi and MQTT.

---

## 12. Data Transmission

The ESP32-S3 collects sensor readings every 5 seconds.

Example JSON message:

```json
{
  "device": "esp32s3-dht22",
  "temperature": 28.50,
  "humidity": 65.20,
  "uptime_ms": 15000
}
```

This JSON message is transmitted using both HTTP and MQTT.

### HTTP Data Path

```text
/sensors/http/esp32s3-dht22
```

### MQTT Data Path

```text
/sensors/mqtt/esp32s3-dht22
```

Both paths store the latest received reading because the current implementations use PUT requests.

---

## 13. Firebase Database Structure

The expected database structure is:

```json
{
  "sensors": {
    "http": {
      "esp32s3-dht22": {
        "device": "esp32s3-dht22",
        "temperature": 28.50,
        "humidity": 65.20,
        "uptime_ms": 15000
      }
    },
    "mqtt": {
      "esp32s3-dht22": {
        "device": "esp32s3-dht22",
        "temperature": 28.50,
        "humidity": 65.20,
        "uptime_ms": 15000
      }
    }
  }
}
```

The values above are illustrative.

HTTP and MQTT readings are stored separately, making protocol comparisons possible.

---

## 14. Testing and Verification

### Test HTTP Communication

1. Start ESP32-S3.
2. Open Arduino Serial Monitor.
3. Check Wi-Fi connection.
4. Verify that HTTP requests return status code 200.
5. Open Firebase Realtime Database.
6. Check `/sensors/http/esp32s3-dht22`.

### Test MQTT Communication

1. Start the Mosquitto broker.
2. Run the Python bridge.
3. Start ESP32-S3.
4. Verify the MQTT connection in Serial Monitor.
5. Check Python terminal output.
6. Open Firebase Realtime Database.
7. Check `/sensors/mqtt/esp32s3-dht22`.

### Example Expected Serial Output

```text
ESP32-S3 DHT22 Firebase Project

DHT22 Initialized.

Connecting to Wi-Fi...
Wi-Fi Connected!

IP Address: 192.168.1.105

MQTT Connected!

========== SENSOR DATA ==========

Temperature: 28.50 °C
Humidity: 65.20 %

JSON Payload:
{"device":"esp32s3-dht22",
"temperature":28.50,
"humidity":65.20,
"uptime_ms":15000}

HTTP Upload Successful!

Publishing MQTT Message...

MQTT Publish Successful!
```

---

## 15. Troubleshooting

| Problem | Possible Solution |
|---|---|
| Wi-Fi not connecting | Check SSID and password |
| DHT22 reading failed | Check wiring and GPIO configuration |
| HTTP error | Verify Firebase URL and database rules |
| MQTT connection failed | Verify broker IP, port and listener configuration |
| MQTT message not received | Check topic subscription |
| Python module not found | Install dependencies using requirements.txt |
| Firebase permission denied | Check Firebase authentication and database rules |
| ESP32 cannot reach broker | Check local network and firewall |
| Invalid sensor readings | Check power, connections and pull-up resistor |

---

## 16. Project Limitations

- Current MQTT communication uses an unauthenticated local broker configuration for development.
- Current HTTP firmware disables TLS certificate verification.
- ESP32 direct Firebase HTTP writes do not yet include authentication.
- The project stores the latest reading instead of maintaining historical records.
- MQTT data reaches Firebase only when the Python bridge is running.
- Internet and local-network connectivity are required.

These configurations should be improved before production deployment.

---

## 17. Future Improvements

- Web-based real-time monitoring dashboard
- Historical sensor data storage
- Temperature and humidity charts
- MQTT authentication and TLS
- Firebase authentication for both pipelines
- Sensor alerts and notifications
- Multiple ESP32 devices
- Data analysis and reporting

---

## 18. Folder Structure

```text
esp32s3-dht22-firebase/
│
├── firmware/
│   └── esp32s3_dht22_firebase/
│       ├── esp32s3_dht22_firebase.ino
│       ├── secrets.h
│       └── secrets.h.example
│
├── bridge/
│   ├── mqtt_to_firebase.py
│   ├── requirements.txt
│   ├── .env
│   └── .env.example
│
├── docs/
│   └── wiring_diagram.png
│
├── .gitignore
│
└── README.md
```

---

## 19. Technologies Used

| Category | Technology |
|---|---|
| Microcontroller | ESP32-S3 |
| Sensor | DHT22 |
| Programming | C++ / Python |
| Firmware IDE | Arduino IDE |
| Connectivity | Wi-Fi |
| Protocol 1 | HTTP/HTTPS |
| Protocol 2 | MQTT |
| MQTT Broker | Mosquitto |
| Backend Bridge | Python |
| Cloud Database | Firebase Realtime Database |
| Data Format | JSON |
| Version Control | Git and GitHub |

---

## 20. License

This project is intended for educational and development purposes.

Add your preferred open-source license before publishing the repository if you intend to grant others permission to reuse or modify the code.

---

**Project: ESP32-S3 DHT22 Firebase Monitoring System**

Built using ESP32-S3, DHT22, HTTP, MQTT, Python, and Firebase Realtime Database.
