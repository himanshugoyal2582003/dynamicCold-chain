import unittest
from unittest.mock import patch

from main import process_iot_telemetry
from models import RawIoTTelemetry


@patch("main.SERVICE_TOKEN", "unit-test-producer")
@patch("main.BACKEND_INGEST_SECRET", "unit-test-ingest")
class TestMaintenanceTelemetryForwarding(unittest.TestCase):
    def setUp(self):
        self.payload = {
            "device_id": "SYNTHETIC-TEST-FIXTURE",
            "connection_number": "TEST-PAIR",
            "temperature": 7.21,
            "humidity": 61.53,
            "timestamp": "2026-11-01T12:02:00Z",
        }

    @patch("main.requests.post")
    def test_forward_preserves_raw_reading_and_missing_door(self, post):
        result = process_iot_telemetry(RawIoTTelemetry(**self.payload))
        self.assertEqual(post.call_args.kwargs["json"]["maintenance_sensor"], {
            "observed_at": self.payload["timestamp"],
            "temperature_c": 7.21,
            "humidity_pct": 61.53,
            "door_open": None,
        })
        self.assertFalse(result.door_open)
        self.assertNotIn("maintenance_sensor", result.model_dump())

    @patch("main.requests.post")
    def test_explicit_closed_door_is_preserved(self, post):
        process_iot_telemetry(RawIoTTelemetry(**self.payload, door_open=False))
        self.assertIs(post.call_args.kwargs["json"]["maintenance_sensor"]["door_open"], False)

    @patch("main.requests.post")
    def test_missing_source_timestamp_cannot_enter_maintenance(self, post):
        without_timestamp = {key: value for key, value in self.payload.items() if key != "timestamp"}
        result = process_iot_telemetry(RawIoTTelemetry(**without_timestamp))
        self.assertTrue(result.timestamp)
        self.assertNotIn("maintenance_sensor", post.call_args.kwargs["json"])

    @patch("main.requests.post")
    def test_unsecured_development_forwards_legacy_payload_only(self, post):
        with patch("main.SERVICE_TOKEN", ""):
            result = process_iot_telemetry(RawIoTTelemetry(**self.payload))
        self.assertEqual(post.call_args.kwargs["json"], result.model_dump())
