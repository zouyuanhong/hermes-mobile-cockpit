"""Server-side proxy for the local WebLLM Harness control surface.

Install this folder as a user Hermes Dashboard plugin.  Create ``config.json``
beside this module with ``harness_url`` and ``harness_token``; that token stays
inside the local dashboard backend and is never included in plugin JavaScript.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import Response


router = APIRouter()
_CONFIG_PATH = Path(__file__).with_name("config.json")


def _config() -> dict[str, str]:
    if not _CONFIG_PATH.is_file():
        raise HTTPException(503, "WebLLM Harness proxy is not configured")
    try:
        values = json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
        url = str(values["harness_url"]).rstrip("/")
        token = str(values["harness_token"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise HTTPException(503, "WebLLM Harness proxy configuration is invalid") from error
    return {"url": url, "token": token}


async def _get(path: str) -> dict[str, Any]:
    config = _config()
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(
                f"{config['url']}{path}",
                headers={"Authorization": f"Bearer {config['token']}"},
            )
    except httpx.HTTPError as error:
        raise HTTPException(502, "WebLLM Harness is unavailable") from error
    if response.status_code >= 400:
        raise HTTPException(response.status_code, "WebLLM Harness rejected the request")
    return response.json()


async def _post(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    config = _config()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{config['url']}{path}",
                headers={"Authorization": f"Bearer {config['token']}"},
                json=payload,
            )
    except httpx.HTTPError as error:
        raise HTTPException(502, "WebLLM Harness is unavailable") from error
    if response.status_code >= 400:
        raise HTTPException(response.status_code, "WebLLM Harness rejected the request")
    return response.json()


@router.get("/webllm/runtime")
async def webllm_runtime() -> dict[str, Any]:
    return await _get("/control/api/runtime")


@router.get("/webllm/tasks")
async def hermes_tasks() -> dict[str, Any]:
    return await _get("/control/api/hermes/tasks")


@router.post("/webllm/platforms/{platform}/actions/{action}")
async def platform_action(
    platform: str,
    action: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> dict[str, Any]:
    return await _post(f"/control/api/platforms/{platform}/actions/{action}", payload)


@router.get("/webllm/platforms/{platform}/inspect")
async def platform_inspection(platform: str) -> dict[str, Any]:
    return await _get(f"/control/api/platforms/{platform}/inspect")


@router.get("/webllm/platforms/{platform}/screenshot")
async def platform_screenshot(platform: str) -> Response:
    config = _config()
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                f"{config['url']}/control/api/platforms/{platform}/screenshot",
                headers={"Authorization": f"Bearer {config['token']}"},
            )
    except httpx.HTTPError as error:
        raise HTTPException(502, "WebLLM Harness is unavailable") from error
    if response.status_code >= 400:
        raise HTTPException(response.status_code, "WebLLM Harness rejected the request")
    return Response(response.content, media_type="image/png", headers={"Cache-Control": "no-store"})
