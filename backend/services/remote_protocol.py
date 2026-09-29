"""Authenticated ServerApp ↔ API messages; no secrets in Flower run-config.

The ServerApp creates an ephemeral signing key before dispatching any clients.
Its public key is announced on the authenticated Flower run's server log. Only
that public key is retained by the API; the private key never leaves ServerApp.
"""
from __future__ import annotations

import base64
import hashlib
import json
import time
import uuid
from urllib import request
from urllib.parse import urlsplit

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

ANNOUNCEMENT = "CONSTELLATION_SERVER_KEY "


def signing_bytes(method: str, path: str, timestamp: str, nonce: str, body: bytes) -> bytes:
    return "\n".join((method, path, timestamp, nonce, hashlib.sha256(body).hexdigest())).encode()


def validate_bridge_url(url: str) -> str:
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password or parts.query or parts.fragment:
        raise ValueError("CONSTELLATION_BRIDGE_URL must be a public HTTPS URL without credentials, query or fragment")
    return url.rstrip("/")


class SignedBridge:
    def __init__(self, url: str, mission_id: str, run_id: str):
        self.url = validate_bridge_url(url)
        self.mission_id = mission_id
        self.run_id = run_id
        self.key = Ed25519PrivateKey.generate()

    def announce(self) -> None:
        public_key = self.key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
        print(ANNOUNCEMENT + json.dumps({"mission_id": self.mission_id, "run_id": self.run_id,
                                        "public_key": base64.b64encode(public_key).decode()}), flush=True)

    def post(self, action: str, value: dict) -> dict:
        url = f"{self.url}/internal/supergrid/{self.mission_id}/{action}"
        data = json.dumps(value, separators=(",", ":")).encode()
        timestamp, nonce = str(int(time.time())), uuid.uuid4().hex
        signature = self.key.sign(signing_bytes("POST", urlsplit(url).path, timestamp, nonce, data))
        req = request.Request(url, data=data, method="POST", headers={
            "Content-Type": "application/json", "X-Constellation-Time": timestamp,
            "X-Constellation-Nonce": nonce,
            "X-Constellation-Signature": base64.b64encode(signature).decode(),
        })
        with request.urlopen(req, timeout=10) as response:
            return json.load(response)
