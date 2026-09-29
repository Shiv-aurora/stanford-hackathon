"""Local-demo tunnel target exposing only signed ServerApp callbacks.

Run with `uv run uvicorn callback_proxy:app --host 127.0.0.1 --port 8012`.
The ordinary mission API remains on loopback port 8011.
"""
from __future__ import annotations

import os
from typing import Literal

import httpx
from fastapi import FastAPI, HTTPException, Request, Response

app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
UPSTREAM = os.environ.get("CONSTELLATION_LOCAL_API", "http://127.0.0.1:8011").rstrip("/")
MAX_BODY = 2 * 1024 * 1024
HEADERS = ("content-type", "x-constellation-time", "x-constellation-nonce", "x-constellation-signature")


@app.post("/internal/supergrid/{mission_id}/{action}")
async def forward(mission_id: str, action: Literal["session", "sync"], request: Request) -> Response:
    chunks = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > MAX_BODY:
            raise HTTPException(413, "Callback exceeds size limit")
        chunks.append(chunk)
    path = f"/internal/supergrid/{mission_id}/{action}"
    headers = {k: request.headers[k] for k in HEADERS if k in request.headers}
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            result = await client.post(UPSTREAM + path, content=b"".join(chunks), headers=headers)
    except httpx.HTTPError:
        raise HTTPException(503, "Local coordinator API is unavailable") from None
    return Response(content=result.content, status_code=result.status_code,
                    media_type=result.headers.get("content-type", "application/json"))
