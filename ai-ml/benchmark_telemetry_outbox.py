"""Measure local SQLite overhead on a labelled synthetic workload."""
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from time import perf_counter
import json

from telemetry_outbox import TelemetryOutbox


class LocalAck:
    status_code = 200
    def json(self):
        return {"success": True, "disposition": "applied"}


def main():
    count = 500
    with TemporaryDirectory() as directory, closing(TelemetryOutbox(str(Path(directory) / "outbox.sqlite"))) as queue:
        started = perf_counter()
        for index in range(count):
            timestamp = datetime.fromtimestamp(1_700_000_000 + index, timezone.utc).isoformat()
            event = {"device_id": "SYNTHETIC-PROBE", "connection_number": "SYNTHETIC-PAIR",
                     "timestamp": timestamp, "temperature": 4.25}
            identifier = queue.event_id(event["device_id"], event["connection_number"], timestamp)
            queue.enqueue(identifier, event)
        admission = perf_counter() - started
        started = perf_counter()
        handled = 0
        while queue.dispatch_one("http://unused.fixture.invalid", "fixture", lambda *args, **kwargs: LocalAck()):
            handled += 1
        delivery = perf_counter() - started
        assert handled == count and queue.metrics()["counts"] == {"delivered": count}
    print(json.dumps({"synthetic": True, "events": count, "admissionMs": round(admission * 1000, 1),
                      "drainMs": round(delivery * 1000, 1), "note": "Local DB only, mocked acknowledgement"}))


if __name__ == "__main__":
    main()
