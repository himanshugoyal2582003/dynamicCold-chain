# Cold Chain IoT Telemetry Schema Specification

## Overview
This specification details the standardized message format exchanged between the ESP32-S3 IoT edge devices, the MQTT gateway/broker, and Firebase Firestore/Realtime Database.

## MQTT Topic Taxonomy

| Topic Pattern | Direction | Description |
|---|---|---|
| `coldchain/{device_id}/telemetry` | Publisher (Device) -> Broker | Periodic temperature & humidity measurements |
| `coldchain/{device_id}/status` | Publisher (Device) -> Broker | LWT (Last Will & Testament) and online state |
| `coldchain/{device_id}/alerts` | Publisher (Device/Bridge) -> Broker | Immediate alarm triggered on threshold excursion |
| `coldchain/{device_id}/config` | Subscriber (Device) <- Broker | Remote configuration (sampling rate, limits) |

## Field Definitions

| Field Name | Type | Range | Description |
|---|---|---|---|
| `device_id` | String | UTF-8 | Fixed hardware ID / unit identifier |
| `timestamp` | ISO-8601 | UTC | Timestamp recorded at sampling |
| `temperature` | Float | -40.0 to 80.0 | Reading from DHT22 (°C) |
| `humidity` | Float | 0.0 to 100.0 | Relative humidity (%RH) |
| `heat_index` | Float | Calculated | Apparent temperature index |
| `rssi` | Integer | -100 to 0 | Wi-Fi signal power in dBm |
| `uptime_sec` | Integer | >= 0 | System uptime since boot |
| `free_heap` | Integer | Bytes | Health metric for memory leak detection |

## Quality of Service (QoS)
- **Telemetry Stream**: QoS 0 (Fire-and-forget for high frequency updates)
- **Alert Messages**: QoS 1 (Guaranteed delivery with ACK for excursions)
- **Birth / LWT**: QoS 1, Retained flag = true
