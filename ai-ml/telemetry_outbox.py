"""Bounded SQLite outbox for enriched telemetry. SQLite must live on a persistent local volume."""
from contextlib import contextmanager
from datetime import datetime, timezone
from hashlib import sha256
import json
import random
import sqlite3
import time
from threading import Lock
from uuid import uuid4

import requests


class QueueFull(Exception):
    pass


class TelemetryOutbox:
    RETENTION = 7 * 86400
    ATTEMPTS = 12
    LEASE = 20
    MAX_BYTES = 16_384

    def __init__(self, path, capacity=5000, clock=time.time, jitter=random.uniform):
        self.path = path
        self.capacity = capacity
        self.clock = clock
        self.jitter = jitter
        self._db_lock = Lock()
        self._connection = sqlite3.connect(self.path, timeout=5, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        with self.db() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS events (
                  id TEXT PRIMARY KEY, payload TEXT NOT NULL, state TEXT NOT NULL,
                  created REAL NOT NULL, available REAL NOT NULL, finished REAL,
                  lease TEXT, attempts INTEGER NOT NULL DEFAULT 0, result TEXT,
                  connection TEXT NOT NULL, observed REAL NOT NULL, prediction TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS events_due ON events(state,available,created);
                CREATE INDEX IF NOT EXISTS events_finished ON events(finished);
                CREATE INDEX IF NOT EXISTS events_observed ON events(connection,observed);
                CREATE TABLE IF NOT EXISTS replay_log (
                  id INTEGER PRIMARY KEY, event_id TEXT NOT NULL, actor TEXT NOT NULL, at REAL NOT NULL
                );
            """)

    @contextmanager
    def db(self):
        with self._db_lock, self._connection:
            yield self._connection

    def close(self):
        with self._db_lock:
            self._connection.close()

    @staticmethod
    def event_id(device, connection, timestamp):
        observed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        if observed.tzinfo is None:
            raise ValueError("Observation timestamp must include a timezone")
        instant = observed.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        key = json.dumps([device.strip(), connection.strip().upper(), instant], separators=(",", ":"), ensure_ascii=False)
        return sha256(key.encode()).hexdigest()

    def existing(self, identifier):
        with self.db() as db:
            row = db.execute("SELECT prediction FROM events WHERE id=?", (identifier,)).fetchone()
            return json.loads(row["prediction"]) if row else None

    def require_capacity(self):
        now = self.clock()
        with self.db() as db:
            retained = db.execute("""
                SELECT count(*) FROM events WHERE state <> 'delivered'
                AND (finished IS NULL OR finished >= ?)
            """, (now - self.RETENTION,)).fetchone()[0]
            if retained >= self.capacity:
                raise QueueFull()

    def enqueue(self, identifier, payload, prediction=None):
        encoded = json.dumps(payload, separators=(",", ":"), allow_nan=False)
        encoded_prediction = json.dumps(payload if prediction is None else prediction, separators=(",", ":"), allow_nan=False)
        if len(encoded.encode()) + len(encoded_prediction.encode()) > self.MAX_BYTES:
            raise ValueError("Telemetry event exceeds maximum size")
        now = self.clock()
        observed = datetime.fromisoformat(payload["timestamp"].replace("Z", "+00:00")).timestamp()
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT 1 FROM events WHERE id=?", (identifier,)).fetchone():
                return
            db.execute("DELETE FROM events WHERE finished < ?", (now - self.RETENTION,))
            if db.execute("SELECT count(*) FROM events").fetchone()[0] >= self.capacity:
                db.execute("""
                  DELETE FROM events WHERE id=(SELECT id FROM events
                    WHERE state='delivered' ORDER BY finished,id LIMIT 1)
                """)
            if db.execute("SELECT count(*) FROM events").fetchone()[0] >= self.capacity:
                raise QueueFull()
            db.execute("""
              INSERT INTO events(id,payload,state,created,available,connection,observed,prediction) VALUES(?,?,'pending',?,?,?,?,?)
            """, (identifier, encoded, now, now, payload["connection_number"].strip().upper(), observed, encoded_prediction))

    def is_latest(self, connection, observed):
        if self.clock() - observed > 120:
            return False
        with self.db() as db:
            latest = db.execute("SELECT max(observed) FROM events WHERE connection=?",
                                (connection.strip().upper(),)).fetchone()[0]
        return latest is None or observed > latest

    def claim(self):
        now = self.clock()
        lease = uuid4().hex
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("""
              UPDATE events SET state='dead',finished=?,result='attempts_exhausted',lease=NULL
              WHERE state='sending' AND available<=? AND attempts>=?
            """, (now, now, self.ATTEMPTS))
            row = db.execute("""
              SELECT id,payload,attempts FROM events WHERE state IN ('pending','sending') AND available<=?
              ORDER BY available,created,id LIMIT 1
            """, (now,)).fetchone()
            if not row:
                return None
            db.execute("UPDATE events SET state='sending',lease=?,attempts=attempts+1,available=? WHERE id=?",
                       (lease, now + self.LEASE, row["id"]))
            return row["id"], json.loads(row["payload"]), row["attempts"] + 1, lease

    def dispatch_one(self, url, secret, post=requests.post):
        job = self.claim()
        if not job:
            return False
        identifier, payload, attempts, lease = job
        status, outcome = 0, "network_error"
        try:
            response = post(url, json=payload, headers={"x-iot-ingest-secret": secret, "x-telemetry-event-id": identifier},
                            timeout=(2, 5), allow_redirects=False)
            status = response.status_code
            if 200 <= status < 300:
                answer = response.json()
                if not isinstance(answer, dict) or answer.get("success") is not True:
                    status, outcome = 0, "invalid_ack"
                else:
                    outcome = answer.get("disposition")
                    if not isinstance(outcome, str) or outcome not in {"applied", "duplicate", "expired", "out_of_order"}:
                        status, outcome = 0, "invalid_ack"
            else:
                outcome = "http_" + str(status)
        except (requests.RequestException, ValueError):
            status, outcome = 0, "network_error_or_invalid_ack"
        if 200 <= status < 300:
            state = "delivered"
        elif attempts >= self.ATTEMPTS or (400 <= status < 500 and status not in {408, 425, 429}):
            state = "dead"
        else:
            state = "pending"
        now = self.clock()
        delay = self.jitter(0.5, 1.0) * min(300, 2 ** attempts) if state == "pending" else 0
        with self.db() as db:
            db.execute("""
              UPDATE events SET state=?,available=?,finished=?,result=?,lease=NULL WHERE id=? AND lease=?
            """, (state, now + delay, None if state == "pending" else now, outcome, identifier, lease))
        return True

    def replay(self, identifier, actor):
        now = self.clock()
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            updated = db.execute("""
              UPDATE events SET state='pending',available=?,finished=NULL,attempts=0,result=NULL
              WHERE id=? AND state='dead'
            """, (now, identifier)).rowcount
            if not updated:
                return False
            db.execute("INSERT INTO replay_log(event_id,actor,at) VALUES(?,?,?)", (identifier, actor, now))
            db.execute("DELETE FROM replay_log WHERE at < ? OR id <= (SELECT max(id)-10000 FROM replay_log)",
                       (now - self.RETENTION,))
            return True

    def metrics(self):
        now = self.clock()
        with self.db() as db:
            counts = dict(db.execute("SELECT state,count(*) FROM events GROUP BY state"))
            outcomes = dict(db.execute("SELECT result,count(*) FROM events WHERE state='delivered' GROUP BY result"))
            oldest = db.execute("SELECT min(created) FROM events WHERE state IN ('pending','sending')").fetchone()[0]
            dead = [dict(row) for row in db.execute("""
              SELECT id,attempts,result,finished FROM events WHERE state='dead' ORDER BY finished DESC LIMIT 25
            """)]
            audit = [dict(row) for row in db.execute("SELECT event_id,actor,at FROM replay_log ORDER BY id DESC LIMIT 25")]
        return {"enabled": True, "capacity": self.capacity, "counts": counts, "outcomes": outcomes,
                "oldestPendingSeconds": round(max(0, now - oldest)) if oldest is not None else None,
                "deadLetters": dead, "replays": audit}
