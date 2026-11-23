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
