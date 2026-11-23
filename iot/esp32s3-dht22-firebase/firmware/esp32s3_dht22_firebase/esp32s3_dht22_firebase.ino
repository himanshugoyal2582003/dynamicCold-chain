
#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <PubSubClient.h>
#include <DHT.h>

#include "secrets.h"


// ==========================================
// 1. OBJECT INITIALIZATION
// ==========================================

DHT dht(DHT_PIN, DHT_TYPE);

WiFiClient mqttNetworkClient;

PubSubClient mqttClient(mqttNetworkClient);


// ==========================================
// 2. GLOBAL VARIABLES
// ==========================================

unsigned long previousSensorTime = 0;

unsigned long previousMqttAttempt = 0;

unsigned long previousWiFiAttempt = 0;

const unsigned long MQTT_RETRY_INTERVAL = 5000UL;

const unsigned long WIFI_RETRY_INTERVAL = 10000UL;


// ==========================================
// 3. WIFI CONNECTION
// ==========================================

void connectWiFi() {

    Serial.println();
    Serial.println("Connecting to Wi-Fi...");

    WiFi.mode(WIFI_STA);

    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    previousWiFiAttempt = millis();

    unsigned long startTime = millis();

    while (WiFi.status() != WL_CONNECTED &&
           millis() - startTime < 20000UL) {

        delay(500);

        Serial.print(".");
    }

    if (WiFi.status() == WL_CONNECTED) {

        Serial.println();

        Serial.println("Wi-Fi Connected!");

        Serial.print("IP Address: ");

        Serial.println(WiFi.localIP());

    } else {

        Serial.println();

        Serial.println("Wi-Fi Connection Failed!");

    }
}


// ==========================================
// 4. WIFI RECONNECTION
// ==========================================

void maintainWiFi() {

    if (WiFi.status() == WL_CONNECTED) {
        return;
    }

    if (millis() - previousWiFiAttempt >=
        WIFI_RETRY_INTERVAL) {

        previousWiFiAttempt = millis();

        Serial.println("Reconnecting to Wi-Fi...");

        WiFi.reconnect();
    }
}


// ==========================================
// 5. MQTT CONNECTION
// ==========================================

void reconnectMQTT() {

    if (WiFi.status() != WL_CONNECTED) {
        return;
    }

    if (mqttClient.connected()) {
        return;
    }

    if (millis() - previousMqttAttempt <
        MQTT_RETRY_INTERVAL) {

        return;
    }

    previousMqttAttempt = millis();

    Serial.println("Connecting to MQTT Broker...");

    if (mqttClient.connect(MQTT_CLIENT_ID)) {

        Serial.println("MQTT Connected!");

        Serial.print("MQTT Topic: ");

        Serial.println(MQTT_TOPIC);

    } else {

        Serial.print("MQTT Connection Failed. State: ");

        Serial.println(mqttClient.state());

    }
}


// ==========================================
// 6. JSON GENERATION
// ==========================================

String createJSON(float temperature,
                  float humidity) {

    char json[200];

    snprintf(
        json,
        sizeof(json),

        "{\"device\":\"esp32s3-dht22\","
        "\"temperature\":%.2f,"
        "\"humidity\":%.2f,"
        "\"uptime_ms\":%lu}",

        temperature,
        humidity,
        (unsigned long)millis()
    );

    return String(json);
}


// ==========================================
// 7. HTTP DATA TRANSMISSION
// ==========================================

void sendHTTP(const String& payload) {

    if (WiFi.status() != WL_CONNECTED) {

        Serial.println("HTTP Failed: Wi-Fi Disconnected.");

        return;
    }

    WiFiClientSecure secureClient;

    // Development/testing only.
    // Production deployments must verify TLS certificates.

    secureClient.setInsecure();

    HTTPClient http;

    String databaseURL = FIREBASE_DATABASE_URL;

    while (databaseURL.endsWith("/")) {

        databaseURL.remove(databaseURL.length() - 1);

    }

    String firebaseURL =
        databaseURL +
        "/sensors/http/esp32s3-dht22.json";

    Serial.println();
    Serial.println("Sending HTTP Request...");

    if (!http.begin(secureClient, firebaseURL)) {

        Serial.println("HTTP Initialization Failed!");

        return;
    }

    http.setConnectTimeout(5000);

    http.setTimeout(5000);

    http.addHeader(
        "Content-Type",
        "application/json"
    );

    int responseCode = http.PUT(payload);

    if (responseCode == 200) {

        Serial.println("HTTP Upload Successful!");

    } else if (responseCode > 0) {

        Serial.print("HTTP Response Code: ");

        Serial.println(responseCode);

        Serial.println(http.getString());

    } else {

        Serial.print("HTTP Error: ");

        Serial.println(
            http.errorToString(responseCode)
        );

    }

    http.end();
}


// ==========================================
// 8. MQTT DATA TRANSMISSION
// ==========================================

void sendMQTT(const String& payload) {

    if (!mqttClient.connected()) {

        Serial.println("MQTT Failed: Broker Disconnected.");

        return;
    }

    Serial.println();
    Serial.println("Publishing MQTT Message...");

    bool published = mqttClient.publish(
        MQTT_TOPIC,
        payload.c_str()
    );

    if (published) {

        Serial.println("MQTT Publish Successful!");

    } else {

        Serial.println("MQTT Publish Failed!");

    }
}


// ==========================================
// 9. DHT22 SENSOR READING
// ==========================================

void readSensor() {

    float humidity = dht.readHumidity();

    float temperature = dht.readTemperature();

    if (isnan(humidity) || isnan(temperature)) {

        Serial.println("DHT22 Sensor Reading Failed!");

        return;
    }

    Serial.println();
    Serial.println("========== SENSOR DATA ==========");

    Serial.print("Temperature: ");

    Serial.print(temperature);

    Serial.println(" °C");

    Serial.print("Humidity: ");

    Serial.print(humidity);

    Serial.println(" %");

    Serial.println("=================================");


    // Generate JSON payload.

    String payload = createJSON(
        temperature,
        humidity
    );

    Serial.println();

    Serial.println("JSON Payload:");

    Serial.println(payload);


    // Send data using HTTP.

    sendHTTP(payload);


    // Publish data using MQTT.

    sendMQTT(payload);
}


// ==========================================
// 10. SETUP
// ==========================================

void setup() {

    Serial.begin(115200);

    delay(1000);

    Serial.println();

    Serial.println("================================");

    Serial.println("ESP32-S3 DHT22 Firebase Project");

    Serial.println("================================");


    // Initialize DHT22.

    dht.begin();

    Serial.println("DHT22 Initialized.");


    // Connect Wi-Fi.

    connectWiFi();


    // Configure MQTT.

    mqttClient.setServer(
        MQTT_BROKER,
        MQTT_PORT
    );

    mqttClient.setKeepAlive(30);

    Serial.println("MQTT Configuration Completed.");

}


// ==========================================
// 11. MAIN LOOP
// ==========================================

void loop() {

    // Maintain Wi-Fi connection.

    maintainWiFi();


    // Maintain MQTT connection.

    reconnectMQTT();

    mqttClient.loop();


    // Periodic sensor reading.

    unsigned long currentTime = millis();

    if (currentTime - previousSensorTime >=
        SENSOR_INTERVAL) {

        previousSensorTime = currentTime;

        if (WiFi.status() == WL_CONNECTED) {

            readSensor();

        } else {

            Serial.println("Waiting for Wi-Fi...");

        }
    }

}
