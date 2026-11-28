import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import requests
from fastapi import Response

import main
from models import RawIoTTelemetry
from telemetry_outbox import QueueFull, TelemetryOutbox


class Reply:
    def __init__(self, status, body=None):
        self.status_code = status
        self.body = body

    def json(self):
        return self.body


class TestOutbox(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = str(Path(directory.name) / "queue.sqlite")
        self.now = 1_700_000_000
        self.queue = self.open()
        self.payload = {"device_id": "TEST-PROBE", "connection_number": "TEST-PAIR",
                        "timestamp": datetime.fromtimestamp(self.now, timezone.utc).isoformat()}
        self.identifier = self.queue.event_id(*self.payload.values())

    def open(self, capacity=1):
        queue = TelemetryOutbox(self.path, capacity, clock=lambda: self.now, jitter=lambda a, b: a)
        self.addCleanup(queue.close)
        return queue

    def test_retries_network_failure_and_recovers_across_instances(self):
        self.queue.enqueue(self.identifier, self.payload)
        def offline(*args, **kwargs):
            raise requests.ConnectionError()
        self.assertTrue(self.queue.dispatch_one("http://local.invalid", "test-only", offline))
        fresh = self.open()
        self.assertFalse(fresh.dispatch_one("http://local.invalid", "test-only", offline))
        self.now += 2
        sent = []
        def send(*args, **kwargs):
            sent.append(kwargs)
            return Reply(200, {"success": True, "disposition": "applied"})
        self.assertTrue(fresh.dispatch_one("http://local.invalid", "test-only", send))
        self.assertEqual(sent[0]["json"], self.payload)
        self.assertEqual(sent[0]["headers"]["x-telemetry-event-id"], self.identifier)
        self.assertEqual(fresh.metrics()["outcomes"], {"applied": 1})

    def test_concurrent_enqueue_deduplicates_and_lease_survives_restart(self):
        with ThreadPoolExecutor(4) as pool:
            list(pool.map(lambda _: self.open().enqueue(self.identifier, self.payload), range(12)))
        self.assertEqual(self.queue.metrics()["counts"], {"pending": 1})
        claimed = self.queue.claim()
        with ThreadPoolExecutor(3) as pool:
            self.assertEqual(list(pool.map(lambda _: self.open().claim(), range(4))), [None]*4)
        self.now += self.queue.LEASE
        recovered = self.open().claim()
        self.assertEqual(recovered[:2], claimed[:2])
        self.assertEqual(recovered[2], 2)
        self.assertNotEqual(recovered[3], claimed[3])

    def test_capacity_dead_letter_and_audited_replay(self):
        self.queue.enqueue(self.identifier, self.payload)
        with self.assertRaises(QueueFull):
            self.queue.enqueue("another", self.payload)
        self.queue.dispatch_one("http://local.invalid", "test-only", lambda *a, **k: Reply(422))
        self.assertEqual(self.queue.metrics()["deadLetters"][0]["result"], "http_422")
        self.assertTrue(self.queue.replay(self.identifier, "fixture-actor"))
        self.assertFalse(self.queue.replay(self.identifier, "fixture-actor"))
        self.queue.dispatch_one("http://local.invalid", "test-only",
                                lambda *a, **k: Reply(200, {"success": True, "disposition": "expired"}))
        self.assertEqual(self.queue.metrics()["outcomes"], {"expired": 1})
        self.assertEqual(self.queue.metrics()["replays"][0]["actor"], "fixture-actor")
        self.queue.enqueue("another", self.payload)
        self.assertEqual(self.queue.metrics()["counts"], {"pending": 1})

    def test_defensive_acknowledgement_and_observation_order(self):
        self.queue.enqueue(self.identifier, self.payload)
        self.assertFalse(self.queue.is_latest("test-pair", self.now))
        self.assertTrue(self.queue.is_latest("TEST-PAIR", self.now+1))
        self.assertFalse(self.queue.is_latest("OTHER", self.now-121))
        self.assertEqual(self.identifier, self.queue.event_id("TEST-PROBE", "test-pair",
                                                             self.payload["timestamp"].replace("+00:00", "Z")))
        self.queue.dispatch_one("http://local.invalid", "test-only", lambda *a, **k: Reply(200, {"success": True}))
        self.assertEqual(self.queue.metrics()["counts"], {"pending": 1})
        self.now += 2
        self.queue.dispatch_one("http://local.invalid", "test-only",
                                lambda *a, **k: Reply(200, {"success": True, "disposition": {}}))
        self.assertEqual(self.queue.metrics()["counts"], {"pending": 1})

    def test_producer_and_monitor_credentials_are_distinct_and_raw_retries_reuse_prediction(self):
        queue = TelemetryOutbox(self.path, 3)
        self.addCleanup(queue.close)
        timestamp = datetime.now(timezone.utc)
        payload = {**self.payload,"timestamp":timestamp.isoformat(),"temperature":4.0,"humidity":65.0}
        key = "outbox-test-inference"
        with patch.multiple(main, outbox=queue, SERVICE_TOKEN="fixture-producer",
                            TELEMETRY_MONITOR_TOKEN="fixture-monitor", BACKEND_INGEST_SECRET="fixture-ingest"), \
             patch.object(main.lstm_engine, "predict_spoilage", wraps=main.lstm_engine.predict_spoilage) as predict:
            payload["truck_id"] = key
            response = Response()
            first = main.process_iot_telemetry(RawIoTTelemetry(**payload), response)
            duplicate = main.process_iot_telemetry(RawIoTTelemetry(**payload))
            self.assertEqual(response.headers["x-telemetry-delivery"], "queued")
            self.assertEqual(first.model_dump(), duplicate.model_dump())
            self.assertEqual(predict.call_count, 1)
            delayed = payload | {"timestamp": datetime.fromtimestamp(timestamp.timestamp()-10, timezone.utc).isoformat()}
            main.process_iot_telemetry(RawIoTTelemetry(**delayed))
            self.assertFalse(predict.call_args.kwargs["record_history"])
            self.assertEqual(len(main.lstm_engine.truck_sequences[key]), 1)
            self.assertEqual(len(main.lstm_engine.truck_ins_sequences[key]), 1)
            with queue.db() as db:
                self.assertTrue(all('"gps":{"lat":null,"lng":null,"speed_kmh":null}' in row["payload"]
                                    for row in db.execute("SELECT payload FROM events")))
            async def monitor_request(token):
                request = SimpleNamespace(url=SimpleNamespace(path="/internal/telemetry-outbox"),
                                          headers={"x-service-token":token})
                async def endpoint(_request):
                    return main.outbox_status()
                return await main.require_service_auth(request, endpoint)
            self.assertEqual(asyncio.run(monitor_request("fixture-producer")).status_code, 401)
            self.assertEqual(asyncio.run(monitor_request("fixturé-monitor")).status_code, 401)
            self.assertEqual(asyncio.run(monitor_request("fixture-monitor"))["counts"], {"pending": 2})
        main.lstm_engine.truck_sequences.pop(key, None)
        main.lstm_engine.truck_ins_sequences.pop(key, None)
