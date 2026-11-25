# Introduction --- Cold-Chain IoT Hardware Setup

**Detailed hardware setup and integration guide**\
*ESP32 · DS18B20 · DHT22 · Magnetic Reed Switch · NEO-6M GPS*

## 1. Introduction and system overview

This guide explains how to assemble and configure the hardware for a
cold-chain monitoring prototype. The ESP32 is the central controller. It
reads:

-   **DS18B20 waterproof temperature probe** --- cargo/probe
    temperature.
-   **DHT22 / AM2302** --- ambient temperature and relative humidity.
-   **Magnetic reed switch** --- door or lid open/closed state.
-   **NEO-6M GPS module** --- latitude and longitude.

The ESP32 can process these readings and transmit them over Wi-Fi to a
monitoring application or server. This guide covers physical wiring and
a basic local hardware test. It does not assume that the backend, cloud
connection, or production enclosure has already been configured.

## 2. Components and their functions

  -----------------------------------------------------------------------
  Component               Purpose                 Connection
  ----------------------- ----------------------- -----------------------
  ESP32 development board Main microcontroller;   GPIO, UART, USB
                          reads sensors and       
                          provides                
                          Wi-Fi/Bluetooth         

  DS18B20 waterproof      Measures temperature at OneWire digital data
  probe                   the monitored           
                          cold-chain location     

  DHT22 / AM2302 module   Measures ambient        Digital data
                          temperature and         
                          relative humidity       

  Magnetic reed switch +  Detects whether a door, Digital input
  magnet                  lid, or access panel is 
                          open                    

  NEO-6M GPS module +     Receives satellite      UART serial
  antenna                 signals for latitude    
                          and longitude           

  Breadboard/perfboard    Provides stable         Interconnect
  and jumper wires        electrical connections  
  -----------------------------------------------------------------------

## 3. Electrical precautions

-   Disconnect USB power before changing any wiring.
-   Use the ESP32 **3V3** pin for the recommended sensor supply. All
    modules and the ESP32 must share a common **GND**.
-   ESP32 GPIO pins use 3.3 V logic and are **not 5 V tolerant**. Never
    connect a 5 V signal directly to a GPIO.
-   Check the exact labels and datasheet for your GPS breakout. Some
    NEO-6M breakout boards accept a wider supply because they include a
    regulator, but UART logic is 3.3 V.
-   Do not power a compressor, refrigeration unit, relay, or other
    high-current load from an ESP32 GPIO.
-   Wire colours are not guaranteed standards. Verify VCC, GND, and DATA
    from the module labels or datasheet.

## 4. Recommended ESP32 pin assignment

The following pin map is a practical example for a common
**ESP32-WROOM-32** development board. Keep the assignments consistent in
the wiring and firmware, and check your exact board pinout before
connecting.

  -----------------------------------------------------------------------
  Device signal           ESP32 connection        Notes
  ----------------------- ----------------------- -----------------------
  DS18B20 DATA            GPIO 4                  Add 4.7 kΩ pull-up from
                                                  DATA to 3V3

  DHT22 DAT               GPIO 18                 Pictured breakout has
                                                  DAT, VCC, GND

  Reed switch signal      GPIO 27                 Use `INPUT_PULLUP`;
                                                  switch connects GPIO to
                                                  GND

  GPS TX                  GPIO 16 (RX2)           GPS TX → ESP32 RX

  GPS RX                  GPIO 17 (TX2)           ESP32 TX → GPS RX

  Sensor VCC              3V3                     Verify GPS breakout
                                                  supply specification

  All grounds             GND                     All grounds connected
                                                  together
  -----------------------------------------------------------------------

## 5. Connecting each component

### 5.1 DS18B20 waterproof temperature probe

The DS18B20 is a digital temperature sensor. Its metal probe can be
placed near the cargo or inside a suitable protective mounting. The
common three-wire version often uses red for VCC, black for GND, and
yellow/white for DATA, but verify the exact cable pinout.

  DS18B20 lead                Connect to
  --------------------------- --------------
  VCC (often red)             ESP32 3V3
  GND (often black)           ESP32 GND
  DATA (often yellow/white)   ESP32 GPIO 4

**Required pull-up resistor:** Add a **4.7 kΩ resistor between DATA
(GPIO 4) and 3V3**. This pull-up is required for a typical three-wire
OneWire circuit. It connects between DATA and 3V3, not in series with
the probe.

Installation notes:

-   Keep the probe cable away from noisy power wiring where possible.
-   Place the probe where it measures representative cargo temperature,
    not directly against a cooling outlet.
-   Protect cable joints and exposed conductors from moisture. The metal
    tip being waterproof does not automatically make the entire cable
    assembly waterproof.

### 5.2 DHT22 / AM2302 temperature and humidity module

The pictured red breakout exposes three labelled pins: **DAT, VCC, and
GND**.

  DHT22 board label   Connect to
  ------------------- ---------------
  VCC                 ESP32 3V3
  GND                 ESP32 GND
  DAT                 ESP32 GPIO 18

Many three-pin breakout boards already include a DATA pull-up resistor.
If you have a bare four-pin DHT22 sensor instead, it normally needs an
external pull-up (commonly 4.7--10 kΩ) between DATA and VCC. Check the
board before adding one.

Installation notes:

-   Allow the sensor to settle after powering it on.
-   A reading interval of about 2 seconds or longer is a sensible
    starting point.
-   Keep it away from condensation and direct contact with cold
    surfaces; it measures the local air around it.

### 5.3 Magnetic reed switch

A magnetic reed switch changes electrical state when its matching magnet
moves close to or away from it. Mount one part on the fixed frame and
the other on the moving door or lid. Align them so the magnet is close
to the switch when the door is closed.

For the **two-wire contact type** shown:

  Reed switch contact   Connect to
  --------------------- ---------------
  One switch lead       ESP32 GND
  Other switch lead     ESP32 GPIO 27

Configure GPIO 27 as `INPUT_PULLUP`. With this wiring, a closed switch
pulls the GPIO LOW and an open switch leaves it HIGH. The example
firmware below interprets HIGH as door OPEN.

Some reed modules have VCC/GND/OUT pins; follow that module's pinout
instead of treating it as a bare two-wire contact.

Installation notes:

-   Test the magnet gap before permanently fixing the parts.
-   Secure the wires so repeated door movement does not pull on the
    electrical joints.
-   For reliable alarms, add software debounce and test both states.

### 5.4 NEO-6M GPS module

The NEO-6M receives navigation satellite signals. The pictured board has
VCC, RX, TX, and GND pins plus a separate ceramic patch antenna
connected by a coaxial lead. The antenna needs a reasonably clear view
of the sky for a reliable first fix.

  -----------------------------------------------------------------------
  GPS module pin                      Connect to
  ----------------------------------- -----------------------------------
  VCC                                 ESP32 3V3 if the specific breakout
                                      supports 3.3 V input; otherwise use
                                      its documented supply input

  GND                                 ESP32 GND

  TX                                  ESP32 GPIO 16 (RX2)

  RX                                  ESP32 GPIO 17 (TX2)
  -----------------------------------------------------------------------

UART wiring is crossed: **GPS TX connects to ESP32 RX, and GPS RX
connects to ESP32 TX**. The GPS can often transmit location data without
its RX pin being connected, but both lines allow configuration commands.

Installation notes:

-   Attach the external antenna gently; do not pull its coaxial cable.
-   Place the ceramic antenna face as recommended by its supplier,
    usually facing upward.
-   A first satellite fix can take several minutes. Test outdoors or
    near a window.
-   GPS reception may be poor inside a metal refrigerated container; an
    externally mounted antenna may be needed.

## 6. Assembly sequence

1.  Place the ESP32 on a breadboard or mount it on perfboard using
    suitable headers or standoffs. Prevent underside solder joints from
    touching conductive surfaces.
2.  With USB unplugged, create common 3V3 and GND rails. Connect all
    sensor grounds to the same ESP32 ground.
3.  Connect DS18B20 to 3V3, GND, and GPIO 4. Add the 4.7 kΩ resistor
    from DATA to 3V3.
4.  Connect DHT22 breakout to 3V3, GND, and GPIO 18.
5.  Connect the two-wire reed switch between GPIO 27 and GND.
6.  Connect GPS power and ground, then cross-connect GPS TX to GPIO 16
    and GPS RX to GPIO 17.
7.  Inspect every connection against the pin map. Check for loose
    strands, reversed power, and accidental shorts.
8.  Connect the ESP32 to the computer using a USB data cable. Do not
    change sensor wiring while powered.

## 7. Preparing the programming environment

A straightforward option is the **Arduino IDE**:

1.  Install the Arduino IDE.
2.  Add ESP32 board support through Boards Manager.
3.  Select the correct ESP32 board and COM port.
4.  Install the following libraries through Library Manager.

  -----------------------------------------------------------------------
  Library                             Purpose
  ----------------------------------- -----------------------------------
  OneWire                             Communication with the DS18B20

  DallasTemperature                   Convenient DS18B20 temperature
                                      readings

  DHT sensor library (Adafruit)       Reading the DHT22

  Adafruit Unified Sensor             Dependency used by the Adafruit DHT
                                      library

  TinyGPSPlus                         Parsing GPS NMEA messages into
                                      latitude and longitude
  -----------------------------------------------------------------------

The ESP32 Arduino core provides `HardwareSerial` for UART. If the
computer does not detect the board, check the USB cable, board
selection, COM port, and whether a USB-to-UART driver is required.

## 8. Combined hardware test sketch

Upload the following sketch after installing the libraries. Open Serial
Monitor at **115200 baud**. The GPS may not show a valid fix until the
antenna has a clear view of the sky.

``` cpp
#include <OneWire.h>
#include <DallasTemperature.h>
#include <DHT.h>
#include <TinyGPSPlus.h>

#define DS18B20_PIN 4
#define DHT_PIN 18
#define DHT_TYPE DHT22
#define REED_PIN 27

OneWire oneWire(DS18B20_PIN);
DallasTemperature ds18b20(&oneWire);
DHT dht(DHT_PIN, DHT_TYPE);
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);

void setup() {
  Serial.begin(115200);
  ds18b20.begin();
  dht.begin();
  pinMode(REED_PIN, INPUT_PULLUP);
  gpsSerial.begin(9600, SERIAL_8N1, 16, 17);
  Serial.println("Cold-chain hardware test started");
}

void loop() {
  ds18b20.requestTemperatures();
  float probeTemp = ds18b20.getTempCByIndex(0);
  float airTemp = dht.readTemperature();
  float humidity = dht.readHumidity();
  bool doorOpen = (digitalRead(REED_PIN) == HIGH);

  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  Serial.println("------------------------------");
  if (probeTemp == DEVICE_DISCONNECTED_C) {
    Serial.println("DS18B20: sensor not detected");
  } else {
    Serial.print("Probe temperature: ");
    Serial.print(probeTemp);
    Serial.println(" C");
  }

  if (isnan(airTemp) || isnan(humidity)) {
    Serial.println("DHT22: reading failed");
  } else {
    Serial.print("Air temperature: ");
    Serial.print(airTemp);
    Serial.println(" C");
    Serial.print("Humidity: ");
    Serial.print(humidity);
    Serial.println(" %");
  }

  Serial.print("Door status: ");
  Serial.println(doorOpen ? "OPEN" : "CLOSED");

  if (gps.location.isValid()) {
    Serial.print("Latitude: ");
    Serial.println(gps.location.lat(), 6);
    Serial.print("Longitude: ");
    Serial.println(gps.location.lng(), 6);
  } else {
    Serial.println("GPS: waiting for a valid satellite fix");
  }
  delay(2000);
}
```

## 9. Testing each component

  -----------------------------------------------------------------------
  Test                    Expected result         If it fails
  ----------------------- ----------------------- -----------------------
  DS18B20                 Plausible temperature   Check DATA pin, common
                          in °C; reading changes  GND, 4.7 kΩ pull-up,
                          gradually when probe is and probe wiring
                          warmed                  

  DHT22                   Temperature and         Check DAT/VCC/GND, GPIO
                          humidity values         18, supply, sensor
                                                  type, and read interval

  Reed switch             Door status changes     Check magnet alignment,
                          when magnet moves       GPIO 27/GND, and
                          toward or away from     `INPUT_PULLUP` logic
                          switch                  

  GPS                     Valid latitude and      Move outdoors; check
                          longitude after         antenna, power, crossed
                          satellite fix           UART wiring, and baud
                                                  rate
  -----------------------------------------------------------------------

## 10. Connecting readings to the cold-chain application

After each component passes its individual test, firmware can package
the values into one telemetry message. Typical fields include device ID,
probe temperature, ambient temperature, humidity, door state, latitude,
longitude, and timestamp.

The backend must define the expected field names, units, authentication
method, and endpoint. The test sketch above only verifies local sensor
wiring and readings; it does **not** automatically connect to the
repository application. Application integration requires firmware that
matches the backend API contract.

## 11. Practical installation recommendations

-   Mount the ESP32 and exposed electronics in a suitable enclosure,
    away from condensation and direct cargo contact.
-   Use cable glands or sealed connectors where sensor wires pass
    through the enclosure.
-   Place the DS18B20 where cargo temperature is representative, using
    an application-appropriate protective mounting.
-   Place the DHT22 where air can circulate around it, away from water
    droplets and cold surfaces.
-   Mount reed switch and magnet on opposite sides of the door seam and
    verify alignment through repeated door cycles.
-   Place the GPS antenna where it can receive satellite signals; metal
    walls can block reception.
-   Add strain relief, label both ends of cables, and secure the board
    for vehicle movement.
-   For real deployment, compare temperature readings against a
    calibrated reference thermometer and validate the complete system
    over its operating range.

## 12. Troubleshooting

  -----------------------------------------------------------------------
  Symptom                             Checks
  ----------------------------------- -----------------------------------
  ESP32 does not power up             Use a data-capable USB cable; check
                                      USB port and shorts between 3V3 and
                                      GND

  DS18B20 shows -127 °C or            Check DATA wiring, pull-up
  disconnected                        resistor, sensor power, and GPIO
                                      definition

  DHT22 prints NaN                    Check pin assignment, VCC/GND,
                                      DHT22 type, and reading interval

  Door state is reversed              Confirm contact behaviour and
                                      reverse the firmware interpretation
                                      if needed

  GPS has no location                 Test outdoors, wait for
                                      acquisition, inspect antenna,
                                      power, UART crossing, and baud rate

  ESP32 resets when sensors are       Check wiring shorts, unstable
  connected                           supply, incorrect voltage, and
                                      loose connections
  -----------------------------------------------------------------------

## 13. Final verification checklist

-   [ ] All modules are mounted securely.
-   [ ] All modules share a common ground.
-   [ ] No ESP32 GPIO receives a 5 V signal.
-   [ ] The DS18B20 pull-up resistor is installed.
-   [ ] Both temperature sensors return plausible readings.
-   [ ] The reed switch correctly detects open and closed positions.
-   [ ] The GPS obtains a fix outdoors.
-   [ ] The system remains stable during an extended test and repeated
    door operation.

------------------------------------------------------------------------

**Note:** This guide describes a recommended wiring example. Confirm the
pin labels and electrical requirements of the exact modules you own
before powering the circuit.


# Dynamic Cold-Chain Fleet Management Platform

## 1. Introduction

The **Dynamic Cold-Chain Fleet Management Platform** is an integrated logistics management system designed to improve the transportation, monitoring, supervision, and management of temperature-sensitive goods. The project focuses on addressing the challenges associated with transporting perishable products such as dairy items, frozen foods, seafood, fresh agricultural produce, and pharmaceutical products, which require specific environmental conditions throughout their transportation journey.

Cold-chain logistics refers to the process of maintaining a controlled temperature environment during the storage, handling, transportation, and distribution of temperature-sensitive products. Maintaining an uninterrupted cold chain is essential because even a small deviation from the required temperature range can negatively affect product quality, reduce shelf life, cause spoilage, and result in financial losses.

Traditional transportation management systems primarily concentrate on vehicle allocation, delivery schedules, and basic shipment tracking. However, these systems may not provide sufficient visibility into the actual environmental conditions inside refrigerated vehicles. In many cases, temperature records are maintained manually, vehicle-related information is scattered across different systems, and fleet owners have limited access to real-time operational information.

The Dynamic Cold-Chain Fleet Management Platform aims to address these challenges by bringing fleet administration, driver management, shipment supervision, IoT-based telemetry simulation, and intelligent risk assessment into a unified digital environment.

The platform follows a modular architecture in which different services are responsible for specific operational activities. The frontend provides an interactive interface for administrators, truck owners, drivers, and IoT device operators. The backend handles authentication, authorization, fleet operations, database communication, and telemetry ingestion. A dedicated IoT layer simulates connected sensor devices, while an AI/ML service processes environmental data and calculates predictive indicators such as spoilage risk, remaining shelf life, and insurance risk.

An important feature of the project is its emphasis on data-driven cold-chain management. Instead of relying exclusively on manual inspection, the platform demonstrates how environmental telemetry and analytical processing can help identify abnormal conditions, evaluate cargo quality risks, and support faster operational decisions.

The system is designed as a scalable foundation that can be extended with physical IoT hardware, advanced machine-learning models, real-world GPS integrations, route optimization, and additional logistics services in future development phases.

---

## 2. Background of the Project

The transportation of temperature-sensitive goods plays an important role in several industries, including:

- Pharmaceutical and healthcare industries.
- Dairy and food processing industries.
- Agriculture and fresh produce distribution.
- Frozen food and seafood transportation.
- Supermarkets and retail supply chains.
- Industrial cold-storage and distribution networks.

Products transported through these industries have different temperature requirements. For example, dairy products generally require refrigerated conditions, frozen products need substantially lower temperatures, and certain pharmaceutical products require carefully controlled storage environments.

During transportation, several factors can affect cargo quality:

1. **Temperature fluctuations:** Changes in internal vehicle temperature may accelerate product degradation.
2. **Refrigeration equipment failure:** A malfunctioning cooling system can cause cargo temperatures to rise beyond acceptable limits.
3. **Frequent door opening:** Opening the refrigerated compartment can introduce warm external air.
4. **Delayed transportation:** Longer transit durations can increase the exposure of products to environmental risks.
5. **Lack of monitoring:** Without continuous monitoring, abnormal conditions may remain undetected for extended periods.
6. **Poor fleet coordination:** Inefficient communication between administrators, owners, and drivers can delay operational responses.
7. **Document management issues:** Expired insurance, permits, and vehicle fitness certificates can create compliance problems.

These challenges demonstrate the importance of having a centralized platform that can combine fleet administration with environmental monitoring and analytical capabilities.

The proposed platform provides a structured approach to managing these activities through separate but interconnected software components.

---

## 3. Problem Statement

Managing a fleet of refrigerated transportation vehicles involves more than tracking vehicle locations and delivery schedules. Fleet operators must also ensure that the transported goods remain within their required environmental conditions.

In conventional fleet management environments, information related to vehicles, drivers, shipments, maintenance, and environmental conditions may be distributed across multiple systems or maintained manually.

This creates several problems:

- Limited visibility into the current condition of refrigerated vehicles.
- Difficulty identifying temperature excursions during transportation.
- Delayed detection of refrigeration-related problems.
- Inadequate coordination between fleet owners and drivers.
- Difficulty maintaining vehicle documentation and compliance records.
- Lack of historical information for evaluating vehicle performance.
- Challenges in estimating the remaining shelf life of sensitive cargo.
- Increased possibility of product spoilage and financial losses.

Furthermore, fleet owners may find it difficult to assess operational risks and make informed decisions without access to consolidated historical and environmental information.

Therefore, a centralized and extensible cold-chain management system is required to integrate fleet administration, driver operations, telemetry processing, and analytical decision support.

---

## 4. Objectives of the Project

The primary objective of the Dynamic Cold-Chain Fleet Management Platform is to develop an integrated digital environment for managing refrigerated transportation operations and improving visibility into cold-chain conditions.

The major objectives are described below.

### 4.1 Centralized Fleet Management

To provide a centralized platform where administrators and fleet owners can manage vehicles, drivers, operational statuses, and transportation records.

### 4.2 Role-Based Access Control

To implement separate access permissions for administrators, truck owners, and truck users so that each category of user can access only the information and functionality relevant to their responsibilities.

### 4.3 Temperature Monitoring

To demonstrate how environmental parameters such as temperature and humidity can be monitored through connected devices or simulated telemetry sources.

### 4.4 Intelligent Risk Assessment

To process environmental data and estimate cargo spoilage risk, remaining shelf life, and quality retention using analytical calculations.

### 4.5 Anomaly Detection

To identify abnormal operating conditions such as temperature spikes, open refrigerated doors, compressor failures, and unusual environmental changes.

### 4.6 Shipment Visibility

To demonstrate vehicle movement, shipment progress, geographical coordinates, and estimated travel time through simulated tracking information.

### 4.7 Operational Coordination

To improve communication between administrators, truck owners, and drivers through a common platform.

### 4.8 Compliance Management

To maintain important vehicle documentation, including insurance, permits, and fitness certificates, and highlight documents approaching their expiry dates.

### 4.9 Scalable Architecture

To develop the application using modular services so that additional hardware integrations, predictive analytics, and logistics capabilities can be incorporated in subsequent development stages.

---

## 5. Overview of the Proposed System

The proposed system is a multi-service application consisting of four major operational components:

1. Frontend Fleet Management Application.
2. Backend Management and API Service.
3. IoT Device Simulation and Gateway.
4. AI/ML and Telemetry Processing Service.

Each component performs a dedicated responsibility while exchanging information with other services.

### 5.1 Frontend Fleet Management Application

The frontend provides the main user interface through which administrators, truck owners, and drivers interact with the platform.

It includes:

- Public landing page.
- User authentication interface.
- Administrator dashboard.
- Truck owner dashboard.
- Driver control panel.
- Fleet and vehicle management screens.
- Shipment and trip information.
- Operational status indicators.

The frontend is developed using Next.js and React. Tailwind CSS is used for styling and responsive layouts.

The public landing page also incorporates a three-dimensional refrigerated truck visualization using Three.js and React Three Fiber.

### 5.2 Backend Management Service

The backend acts as the central application server.

It is responsible for:

- User authentication.
- Role-based authorization.
- Vehicle management.
- Owner management.
- Driver assignment.
- Trip management.
- Issue reporting.
- Database communication.
- Telemetry ingestion.
- Fleet-related API operations.

The backend is implemented using NestJS, a Node.js framework based on TypeScript.

It provides structured API modules for different application functionalities and communicates with a PostgreSQL database hosted through Neon.

### 5.3 IoT Device Simulation and Gateway

The IoT component demonstrates how connected devices installed inside refrigerated transportation vehicles can communicate environmental information to the platform.

The current implementation includes an IoT simulation portal where users can configure devices, generate telemetry, control device states, introduce abnormal conditions, and transmit information to the processing service.

The simulated devices represent sensor units that can provide information such as:

- Internal temperature.
- Humidity.
- Target temperature.
- Battery level.
- Door status.
- Device connection status.
- Associated truck information.

The simulation environment helps demonstrate the complete data flow without requiring physical sensor hardware for every test.

### 5.4 AI/ML and Telemetry Processing Service

The AI/ML component provides analytical processing capabilities for environmental telemetry and cold-chain risk evaluation.

It is developed using Python and FastAPI.

Its responsibilities include:

- Processing incoming sensor information.
- Estimating spoilage risk.
- Calculating remaining shelf life.
- Evaluating temperature-related abnormalities.
- Generating cargo quality indicators.
- Producing operational recommendations.
- Estimating risk-based insurance pricing.
- Forwarding processed telemetry to the main backend.

The current implementation uses simulation-based calculations and rule-based analytical models. It should not be confused with a fully trained machine-learning system using a verified real-world dataset.

---

## 6. System Architecture

The platform follows a modular, service-oriented architecture in which individual components communicate through APIs and real-time communication channels.

The major architectural components are:

| Component | Technology | Responsibility |
|---|---|---|
| Main frontend | Next.js, React | Fleet management interface |
| UI styling | Tailwind CSS | Responsive user interface |
| 3D visualization | Three.js, React Three Fiber | Animated truck visualization |
| Main backend | NestJS, Node.js | Application APIs and business logic |
| Programming language | TypeScript | Frontend and backend development |
| Database | PostgreSQL | Persistent application data |
| Database hosting | Neon | Managed PostgreSQL infrastructure |
| IoT portal | Next.js | Device configuration and simulation |
| AI/ML service | Python, FastAPI | Telemetry analysis and prediction |
| Data validation | Pydantic | Validation of analytical service payloads |
| Real-time communication | WebSockets, Socket.IO | Live data communication |

### 6.1 High-Level Data Flow

The general telemetry processing workflow is:

1. An IoT device or simulator generates environmental readings.
2. The IoT portal collects the device information.
3. The telemetry information is forwarded to the AI/ML service.
4. The AI/ML service processes the incoming information.
5. Risk indicators, shelf-life estimates, and recommendations are generated.
6. Processed telemetry is forwarded to the main NestJS backend.
7. The backend receives and manages the processed information.
8. The frontend displays relevant information through fleet and monitoring interfaces.

This architecture separates data generation, analytical processing, application management, and user interaction.

### 6.2 Architectural Representation

```text
                USERS
                  |
                  v
       FRONTEND MANAGEMENT PORTAL
              Next.js
                  |
                  v
         MAIN BACKEND SERVICE
               NestJS
                  |
          +-------+-------+
          |               |
          v               v
      PostgreSQL       Telemetry
        Neon            Ingestion
                          ^
                          |
                          |
                 AI/ML PROCESSING
                     FastAPI
                          ^
                          |
                          |
                  IoT GATEWAY
                   Next.js
                          ^
                          |
                          |
                SIMULATED IoT DEVICES
              Temperature / Humidity
                  Door / GPS Data
```

The architecture supports independent development and maintenance of different application modules while allowing them to exchange information through defined interfaces.

---

## 7. User Roles and Access Management

The platform is designed around three primary user categories.

### 7.1 Administrator

The administrator is responsible for managing the overall platform.

Major responsibilities include:

- Viewing fleet-wide statistics.
- Managing truck owners.
- Registering and managing vehicles.
- Creating and managing driver accounts.
- Assigning drivers to vehicles.
- Monitoring vehicle statuses.
- Reviewing operational activities.
- Managing fleet information.

The administrator has access to the overall system data.

### 7.2 Truck Owner

A truck owner manages vehicles belonging to their own fleet.

The owner dashboard is designed to provide information about:

- Registered vehicles.
- Vehicle registration numbers.
- Vehicle types.
- Carrying capacities.
- Current vehicle status.
- Assigned drivers.
- Insurance expiry dates.
- Permit expiry dates.
- Fitness certificate expiry dates.
- Vehicle-related information and trip history.

Owners can manage their vehicles, update relevant information, assign drivers, and monitor their fleet.

An important security requirement is that one owner must not be able to access or modify another owner's vehicle information.

### 7.3 Truck User / Driver

The truck user represents the driver or operator assigned to a particular vehicle.

The driver interface is designed primarily for mobile devices.

Its functionalities include:

- Viewing assigned vehicle information.
- Checking vehicle status.
- Starting a transportation trip.
- Ending an active trip.
- Entering trip origin and destination.
- Recording cargo information.
- Adding trip notes.
- Setting the target cargo temperature manually.
- Reporting vehicle-related issues.
- Viewing previous trips.

Drivers are restricted to the information associated with their assigned vehicle.

---

## 8. Authentication and Security

Security is an important part of the platform because different users have different responsibilities and access permissions.

The application uses authentication and role-based authorization to control access to protected resources.

### 8.1 User Authentication

Users authenticate themselves through an email and password combination.

The authentication system verifies the submitted credentials and establishes an authenticated session.

### 8.2 Password Security

Passwords are stored using secure password hashing rather than being stored as plain text.

The backend includes bcryptjs for password hashing and verification.

### 8.3 JWT-Based Authentication

JSON Web Tokens are used as part of the authentication mechanism.

The backend uses JWT-related libraries and cookie handling to support authenticated requests.

The intended session architecture stores authentication tokens in HTTP-only cookies, reducing direct access to authentication tokens through client-side JavaScript.

### 8.4 Role-Based Authorization

The backend applies authorization checks according to the authenticated user's role.

The major roles are:

- Admin.
- Owner.
- Truck User.

Authorization checks are enforced on the server rather than depending only on frontend navigation restrictions.

### 8.5 API Validation

The backend uses validation mechanisms to check incoming request data.

NestJS validation pipes, class-validator, and class-transformer are included to validate and transform request payloads.

The AI/ML service uses Pydantic models to validate incoming telemetry and prediction requests.

### 8.6 Service-to-Service Security

The AI/ML service includes service-token authentication for protected HTTP endpoints and WebSocket connections.

The telemetry ingestion endpoint on the main backend also uses a separate ingestion secret.

These mechanisms help distinguish trusted service communication from ordinary unauthenticated requests.

---

## 9. Frontend Development and User Interface

The frontend is responsible for presenting information in a clear and accessible format.

The project uses Next.js 14, React 18, TypeScript, and Tailwind CSS.

### 9.1 Public Landing Page

The landing page introduces the cold-chain management platform.

Its major elements include:

- Platform branding.
- Project introduction.
- Sign-in navigation.
- Three-dimensional refrigerated truck visualization.
- Access to the IoT portal.
- Basic system information.

The landing page uses a refined visual design based on white backgrounds, restrained gold accents, and clear typography.

### 9.2 Three-Dimensional Truck Visualization

The platform incorporates a three-dimensional truck visualization using:

- Three.js.
- React Three Fiber.
- Supporting 3D rendering components.

The purpose of this visualization is to make the landing page more engaging while communicating the project's focus on refrigerated transportation.

The intended animation includes vehicle movement, wheel rotation, and subtle idle motion.

### 9.3 Administrator Dashboard

The administrator dashboard provides a centralized view of fleet operations.

Its planned dashboard information includes:

- Total truck owners.
- Total registered vehicles.
- Total active drivers.
- Vehicles currently on trips.
- Recent administrative activities.

It also provides management functionality for owners, trucks, and users.

### 9.4 Truck Owner Dashboard

The owner interface focuses on vehicle and fleet management.

It provides vehicle information in structured lists and detail views.

Important information includes registration numbers, capacity, vehicle status, driver assignment, and document expiry details.

### 9.5 Driver Control Panel

The driver interface is designed with a mobile-first approach.

The primary objective is to make common transportation activities accessible without requiring drivers to navigate complicated administrative screens.

Important actions include starting a trip, ending a trip, entering shipment information, and reporting issues.

### 9.6 Responsive Design

The frontend uses responsive layouts to support desktop, tablet, and mobile devices.

The design specifications target screen widths down to approximately 360 pixels.

This is particularly important for drivers who may primarily access the platform through smartphones.

---

## 10. Backend Development

The backend provides the business logic and application services required by the platform.

It is developed using NestJS and TypeScript.

NestJS provides a modular architecture that makes it easier to organize application functionality into independent modules.

### 10.1 Main Backend Modules

The repository includes modules for:

- Authentication.
- Administration.
- Owner management.
- Truck management.
- IoT integration.
- Tracking.
- Trip management.
- Database connectivity.

Each module is responsible for a specific group of operations.

### 10.2 REST API Architecture

The backend exposes API endpoints that allow the frontend and other services to communicate with the application.

Examples of application operations include:

- User login and logout.
- Retrieving authenticated user information.
- Creating and updating fleet records.
- Assigning drivers.
- Managing trip information.
- Reporting issues.
- Receiving processed telemetry.

### 10.3 Database Connectivity

The backend communicates with PostgreSQL through the Neon database infrastructure.

The application includes database-related utilities for initialization, migrations, and administrative account bootstrapping.

### 10.4 Telemetry Ingestion

The backend includes an IoT module responsible for receiving processed telemetry from the AI/ML service.

This allows analytical information to become part of the main fleet management environment.

---

## 11. Database Management

The project uses PostgreSQL as its relational database management system.

The database is hosted using Neon, a managed serverless PostgreSQL platform.

A relational database is suitable for this project because the application contains several interconnected entities, including users, vehicles, owners, trips, and reported issues.

### 11.1 Important Data Entities

The project specifications define the following primary entities.

**Users**

Stores user-related information.

Important attributes include:

- User ID.
- Name.
- Email.
- Password hash.
- Role.
- Owner association.
- Assigned truck.
- Account activation status.
- Creation timestamp.

**Trucks**

Stores vehicle information.

Important attributes include:

- Truck ID.
- Owner ID.
- Registration number.
- Vehicle type.
- Carrying capacity.
- Current status.
- Target temperature.
- Insurance expiry.
- Permit expiry.
- Fitness certificate expiry.

**Trips**

Stores transportation-related information.

Important attributes include:

- Trip ID.
- Truck ID.
- Driver ID.
- Origin.
- Destination.
- Cargo type.
- Trip notes.
- Start time.
- End time.

**Issues**

Stores problems reported by drivers.

Important attributes include:

- Issue ID.
- Truck ID.
- Reporting user.
- Issue description.
- Issue status.
- Creation timestamp.

**Activity Log**

Maintains records of important administrative activities.

Important attributes include:

- Activity ID.
- User who performed the action.
- Action type.
- Associated entity.
- Entity ID.
- Creation timestamp.

These entities establish the foundation for managing the relationships between users, vehicles, transportation operations, and administrative activities.

---

## 12. IoT Integration and Device Simulation

The IoT component is one of the important technological aspects of the platform.

Its purpose is to demonstrate how sensor-based monitoring can improve visibility into refrigerated transportation conditions.

The repository contains a dedicated IoT portal developed using Next.js.

### 12.1 Simulated Sensor Parameters

The simulated devices can represent different environmental and operational parameters.

**Temperature**

Represents the internal temperature of the refrigerated compartment.

**Humidity**

Represents the relative humidity inside the cargo environment.

**Target Temperature**

Represents the desired temperature configured for a particular product.

**Door Status**

Indicates whether the refrigerated compartment door is open or closed.

**Battery Level**

Represents the remaining battery level of a simulated sensor device.

**Device Status**

Indicates whether the device is powered on and available for communication.

### 12.2 Device Management

The IoT portal provides functionality for:

- Adding simulated devices.
- Selecting product categories.
- Configuring target temperatures.
- Controlling device power.
- Adjusting the number of simulated devices.
- Broadcasting telemetry from multiple devices.
- Enabling automatic data streaming.
- Viewing device statistics.
- Introducing simulated abnormal conditions.
- Reviewing operational logs.

### 12.3 Anomaly Simulation

The system supports the simulation of several abnormal conditions, including:

1. Temperature spike.
2. Refrigerated compartment door opening.
3. Compressor failure.
4. Rapid defrost.
5. Resetting the simulated device to normal operation.

These conditions help demonstrate how a monitoring system can respond to unusual environmental situations.

### 12.4 Continuous Telemetry

The AI/ML service contains a background simulation mechanism that updates truck telemetry periodically.

It also supports WebSocket connections for sending vehicle-specific telemetry updates to connected clients.

The current implementation demonstrates the communication architecture through simulated devices rather than requiring every test to use physical sensors.

### 12.5 Future Physical Hardware Integration

The system architecture can be extended to support physical sensor devices such as ESP32-based monitoring units.

Potential hardware components include:

- ESP32 microcontroller.
- Temperature sensors.
- Humidity sensors.
- Door-position sensors.
- GPS modules.
- Battery monitoring circuits.

With appropriate firmware and communication interfaces, these devices could transmit actual environmental readings to the backend infrastructure.

Physical hardware integration should be considered an extension of the existing simulation architecture rather than assumed to be fully implemented by the current simulator.

---

## 13. AI/ML and Intelligent Analytics

The AI/ML service is implemented using Python and FastAPI.

It provides analytical functionality related to cargo quality, temperature excursions, spoilage risk, and insurance pricing.

The service contains different processing mechanisms that transform environmental and operational information into useful indicators.

### 13.1 Shelf-Life Prediction

One of the major analytical functionalities is the estimation of remaining cargo shelf life.

Different products have different temperature requirements and baseline shelf-life values.

The system includes product profiles for:

- Pharmaceuticals.
- Dairy products.
- Ice cream and frozen desserts.
- Fresh produce.
- Frozen seafood.

The shelf-life calculation considers parameters such as:

- Average transportation temperature.
- Maximum recorded temperature.
- Product category.
- Transportation duration.
- Product-specific temperature thresholds.

The current prediction endpoint uses a mathematical degradation calculation to estimate remaining shelf life.

The general relationship is:

**Effective elapsed time = Transit duration × Degradation rate**

The degradation rate increases when the average transportation temperature exceeds the recommended target or the maximum temperature exceeds a critical threshold.

The remaining shelf life is then estimated by subtracting the effective elapsed time from the baseline shelf life.

The result includes:

- Product category.
- Baseline shelf life.
- Predicted remaining shelf life.
- Quality retention percentage.
- Spoilage risk classification.
- Recommended operational action.

### 13.2 Spoilage Risk Classification

The service classifies cargo quality risk into four categories:

| Risk Level | Interpretation |
|---|---|
| LOW | Cargo conditions are within acceptable limits |
| MODERATE | Minor environmental deviation requires monitoring |
| HIGH | Significant thermal stress requires attention |
| CRITICAL | Severe environmental deviation requires immediate action |

These categories help operators understand the severity of environmental conditions without interpreting raw sensor values individually.

### 13.3 Real-Time Anomaly Assessment

The simulation service evaluates abnormal operating conditions and generates indicators based on temperature deviation and equipment status.

For example:

- An open compartment door can increase internal temperature.
- Compressor failure can cause gradual warming.
- Temperature spikes can generate critical alerts.
- Normal refrigeration operation attempts to maintain the configured target temperature.

The simulator also maintains historical telemetry readings for analysis.

### 13.4 IoT Telemetry Processing Pipeline

The AI/ML service includes an endpoint for processing incoming IoT telemetry.

The processing workflow involves:

1. Receiving raw sensor information.
2. Identifying the relevant product profile.
3. Evaluating temperature deviation.
4. Calculating spoilage risk.
5. Estimating remaining shelf life.
6. Determining the risk category.
7. Generating an operational recommendation.
8. Preparing processed telemetry.
9. Forwarding the information to the main backend.

### 13.5 Dynamic Insurance Pricing

Another analytical feature is the insurance pricing prediction endpoint.

It evaluates operational risk indicators such as:

- Temperature excursion count.
- Average temperature deviation.
- Door-opening incidents.
- Reported incidents.
- Number of completed trips.
- Duration of vehicle service.

The service calculates a risk score and classifies the vehicle into different risk categories.

Based on the calculated score, the system can demonstrate:

- Discounts for lower-risk operational profiles.
- Standard pricing for normal-risk profiles.
- Premium surcharges for higher-risk profiles.

This feature demonstrates how cold-chain compliance information could potentially be used in risk-based insurance assessment.

The pricing calculation is currently a rule-based analytical model and should not be interpreted as an actuarially validated insurance pricing system.

### 13.6 Technology Used in the AI/ML Service

The service uses:

- Python.
- FastAPI.
- Pydantic.
- Uvicorn.
- WebSockets.
- NumPy.
- Pandas.
- Plotly.
- Requests.

These technologies support API development, data validation, telemetry processing, and analytical visualization.

---

## 14. Shipment Tracking and Route Information

Transportation visibility is another important aspect of cold-chain management.

The AI/ML simulation service contains predefined transportation corridors with geographical waypoints.

Each simulated vehicle maintains information about:

- Origin.
- Destination.
- GPS coordinates.
- Vehicle speed.
- Direction of movement.
- Route progress.
- Estimated remaining travel time.
- Associated shipment.
- Environmental conditions.

The simulator calculates approximate vehicle movement by interpolating geographical coordinates between predefined waypoints.

This allows the application to demonstrate vehicle movement and shipment progress without requiring continuous access to physical GPS hardware.

The telemetry processing service also generates route-related operational recommendations based on calculated spoilage risk.

For example, a critical risk condition may trigger a recommendation to divert the shipment towards a safer cold-storage facility.

It is important to distinguish these recommendations from a fully implemented route optimization engine. The current implementation uses predefined recommendation logic and simulated corridor information.

---

## 15. Technology Stack

The project uses several modern technologies across frontend development, backend services, data storage, and analytical processing.

### 15.1 Frontend Technologies

**Next.js**

A React-based framework used to develop the main fleet management application and the IoT portal.

**React**

Used to develop reusable UI components and interactive application interfaces.

**TypeScript**

Provides static typing and improves code organization and maintainability.

**Tailwind CSS**

Used for responsive styling and consistent UI development.

**Three.js**

Provides three-dimensional rendering capabilities.

**React Three Fiber**

Connects Three.js with React components to create the animated truck visualization.

**Lucide React**

Provides icons for application interfaces.

### 15.2 Backend Technologies

**Node.js**

Provides the JavaScript runtime environment for the main backend.

**NestJS**

Provides a modular framework for building scalable server-side applications.

**REST APIs**

Allow the frontend, IoT layer, and backend services to exchange structured information.

**Socket.IO and WebSockets**

Support real-time communication capabilities.

**JWT and bcryptjs**

Support authentication and password security.

### 15.3 Database Technologies

**PostgreSQL**

A relational database used to organize application information.

**Neon**

Provides managed PostgreSQL hosting and database connectivity.

### 15.4 AI/ML Technologies

**Python**

Used for analytical calculations and telemetry processing.

**FastAPI**

Provides API endpoints for prediction and data processing.

**Pydantic**

Validates incoming data and defines structured request and response models.

**NumPy and Pandas**

Provide libraries for numerical and data-processing operations.

**Plotly**

Supports analytical data visualization.

### 15.5 Development and Execution Tools

The project uses npm scripts to manage the different services.

The root package configuration provides separate commands for starting the frontend, backend, IoT portal, and AI/ML service.

This allows each service to run independently during development.

---

## 16. Major Features of the Platform

The following table summarizes the important functionalities of the project.

| Feature | Description |
|---|---|
| User Authentication | Secure login and session management |
| Role-Based Access | Separate permissions for administrators, owners, and drivers |
| Fleet Management | Centralized vehicle registration and management |
| Driver Management | Creation and assignment of driver accounts |
| Trip Management | Starting, ending, and recording transportation trips |
| Issue Reporting | Recording vehicle-related problems |
| Document Monitoring | Tracking insurance, permit, and fitness expiry |
| IoT Simulation | Generating environmental sensor readings |
| Device Management | Adding and controlling simulated IoT devices |
| Anomaly Simulation | Testing abnormal temperature and equipment conditions |
| Telemetry Processing | Processing incoming environmental information |
| Shelf-Life Estimation | Estimating remaining cargo shelf life |
| Spoilage Risk Analysis | Categorizing cargo quality risks |
| Insurance Risk Assessment | Demonstrating risk-based premium calculations |
| Shipment Tracking | Simulating geographical vehicle movement |
| Real-Time Communication | Transmitting telemetry using WebSockets |
| 3D Visualization | Displaying an animated refrigerated truck |

---

## 17. Applications of the Project

The Dynamic Cold-Chain Fleet Management Platform can be applied in several industries where transportation conditions directly influence product quality.

### 17.1 Pharmaceutical Transportation

Certain medicines, vaccines, and pharmaceutical products require controlled temperature conditions.

The platform demonstrates how continuous environmental monitoring and abnormal-condition alerts can support safer pharmaceutical transportation.

### 17.2 Dairy Distribution

Milk, cream, cheese, and other dairy products require refrigerated transportation.

Monitoring temperature changes can help identify conditions that may accelerate product spoilage.

### 17.3 Frozen Food Transportation

Frozen food products require low-temperature transportation environments.

The platform's product profiles and simulated telemetry demonstrate how different temperature requirements can be handled.

### 17.4 Agriculture and Fresh Produce

Fresh fruits and vegetables are sensitive to temperature and humidity conditions.

The platform can provide a foundation for monitoring environmental parameters during transportation.

### 17.5 Seafood Logistics

Seafood products require carefully maintained storage conditions to preserve freshness and quality.

Temperature monitoring and spoilage risk assessment can support improved transportation supervision.

### 17.6 Fleet Management Companies

Companies operating refrigerated vehicle fleets can use centralized dashboards to manage drivers, vehicles, trips, and operational information.

---

## 18. Advantages of the Proposed System

The proposed platform offers several advantages over fragmented and predominantly manual fleet management processes.

### 18.1 Centralized Management

Vehicle, driver, trip, and operational information can be managed through a unified platform.

### 18.2 Improved Visibility

The system demonstrates how environmental telemetry and shipment information can be made available through monitoring interfaces.

### 18.3 Early Identification of Abnormal Conditions

Simulated anomaly detection and risk classification demonstrate how temperature excursions and refrigeration problems can be identified.

### 18.4 Better Operational Coordination

Separate interfaces for administrators, owners, and drivers provide a structured approach to fleet operations.

### 18.5 Data-Driven Decisions

Analytical indicators such as remaining shelf life and spoilage risk provide additional information for operational decision-making.

### 18.6 Modular Architecture

The separation of frontend, backend, IoT, and analytical services makes the system easier to extend and maintain.

### 18.7 Reduced Manual Monitoring

Automation of telemetry processing and fleet information management can reduce dependence on manual record maintenance.

### 18.8 Extensibility

The platform provides a foundation for integrating physical sensors, advanced machine-learning models, and external logistics services.

---

## 19. Limitations and Current Implementation Scope

Although the platform demonstrates several advanced cold-chain management concepts, certain limitations should be considered.

1. **Simulated IoT Data:** The current IoT portal includes simulated devices and generated telemetry. It does not establish that physical sensors are connected and transmitting real-world readings.

2. **Analytical Model Limitations:** The current shelf-life and risk calculations are based on mathematical and rule-based methods. Their outputs are estimates rather than scientifically validated guarantees of product quality.

3. **Simulated GPS Information:** Vehicle movement is demonstrated through predefined routes and interpolated coordinates rather than confirmed live GPS hardware.

4. **Route Recommendations:** The current system provides predefined risk-based recommendations, not a complete traffic-aware route optimization engine.

5. **Environmental Accuracy:** Actual cargo quality depends on several additional factors, including packaging, product characteristics, loading conditions, humidity, and temperature history.

6. **Hardware Dependency:** Physical deployment requires appropriate sensors, microcontrollers, connectivity, calibration, and device integration.

7. **Deployment Requirements:** The different services require their respective environments, configuration variables, database connectivity, and service credentials.

These limitations identify areas where further development and real-world testing would be necessary.

---

## 20. Future Scope

The project provides a foundation for several future improvements.

### 20.1 Physical IoT Hardware Integration

The simulated device architecture can be extended using ESP32 microcontrollers and physical environmental sensors.

This would enable the system to receive actual temperature and humidity measurements from refrigerated vehicles.

### 20.2 Advanced Machine-Learning Models

The current mathematical prediction methods could be supplemented with trained machine-learning models.

Historical transportation data could be used to develop more sophisticated shelf-life estimation and spoilage prediction systems.

### 20.3 Live GPS Integration

Physical GPS modules or external location services could be integrated to obtain actual vehicle coordinates.

### 20.4 Intelligent Route Optimization

A future route optimization module could consider:

- Traffic conditions.
- Delivery deadlines.
- Remaining cargo shelf life.
- Vehicle restrictions.
- Distance to nearby cold-storage facilities.
- Current vehicle location.

This would enable more intelligent transportation recommendations.

### 20.5 Automated Notifications

Email, SMS, and push notifications could be integrated to inform owners and administrators about critical temperature excursions, equipment failures, and document expiry.

### 20.6 Advanced Analytics Dashboard

Historical telemetry could be used to generate reports on:

- Temperature compliance.
- Vehicle performance.
- Driver performance.
- Spoilage incidents.
- Average delivery duration.
- Refrigeration equipment reliability.

### 20.7 Predictive Maintenance

Historical equipment information and sensor readings could be used to identify patterns associated with possible refrigeration system failures.

### 20.8 Cloud Deployment and Scalability

The services could be deployed through cloud infrastructure with automated deployment pipelines, monitoring, logging, and scalable service management.

### 20.9 Digital Twin Integration

A digital representation of each refrigerated vehicle could be developed to combine vehicle status, sensor readings, environmental conditions, and shipment progress into a unified operational model.

---

## 21. Conclusion

The **Dynamic Cold-Chain Fleet Management Platform** demonstrates how modern web technologies, backend services, IoT simulation, and analytical processing can be combined to improve the management of temperature-sensitive transportation operations.

The project addresses important challenges in cold-chain logistics, including fleet administration, driver coordination, environmental monitoring, abnormal-condition identification, cargo shelf-life estimation, and operational risk assessment.

By providing separate interfaces for administrators, truck owners, and drivers, the platform establishes a structured environment for managing fleet-related activities. Its modular backend architecture supports application services and database communication, while the dedicated IoT and AI/ML components demonstrate how sensor information can be processed into meaningful operational indicators.

An important aspect of the project is the integration of multiple technologies into a common application architecture. Next.js and React provide the user interfaces, NestJS handles application services, PostgreSQL stores structured information, and Python with FastAPI provides analytical processing capabilities.

The use of simulated telemetry also makes it possible to demonstrate and test the data-processing pipeline without requiring a complete physical hardware installation.

Overall, the project serves as a foundation for a more intelligent, connected, and data-driven cold-chain transportation management environment. With future integration of physical IoT devices, validated predictive models, live GPS services, and intelligent route optimization, the platform can be extended towards a comprehensive solution for modern refrigerated logistics operations.

---

## 22. Project Repository

**GitHub Repository:**  
https://github.com/himanshugoyal2582003/dynamicCold-chain

**Project Name:** Dynamic Cold-Chain Fleet Management Platform

**Team:** Elite Avengers

**Institution:** GLA University, Mathura

**Academic Session:** 2026–27

**Primary Development Technologies:** Next.js, React, TypeScript, NestJS, PostgreSQL, Neon, Python, FastAPI, Three.js, and Tailwind CSS.