"""
FastAPI server -- exposes an A1111-compatible REST API backed by Diffusers.

Endpoints implemented:
    GET  /sdapi/v1/options      -- server info / health check
    GET  /sdapi/v1/sd-models    -- list available checkpoints
    GET  /sdapi/v1/loras        -- list available LoRAs
    POST /sdapi/v1/txt2img      -- generate an image

These match the Automatic1111 WebUI API surface that the MangaREADME
frontend already speaks.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from manga_readme import __version__
from manga_readme.models import list_models as _list_models, get_model
from manga_readme.pipeline import (
    current_model_repo,
    is_loaded,
    list_available_loras,
    load_model,
    txt2img,
)

logger = logging.getLogger("manga_readme.server")

# ---------------------------------------------------------------------------
#  App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="manga-readme",
    version=__version__,
    description="Local Diffusers backend for MangaREADME Generator",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
#  Schemas
# ---------------------------------------------------------------------------

class Txt2ImgRequest(BaseModel):
    prompt: str = ""
    negative_prompt: str = ""
    width: int = 512
    height: int = 512
    steps: int = 30
    cfg_scale: float = 7.5
    seed: int = -1
    sampler_name: str | None = "DPM++ 2M"
    scheduler: str | None = None
    batch_size: int = 1
    n_iter: int = 1
    override_settings: dict[str, Any] | None = None


class Txt2ImgResponse(BaseModel):
    images: list[str]
    parameters: dict[str, Any]
    info: str


class OptionsResponse(BaseModel):
    sd_model_checkpoint: str = ""
    manga_readme_version: str = __version__


class SDModelEntry(BaseModel):
    title: str
    model_name: str
    hash: str = ""
    sha256: str = ""
    filename: str = ""
    config: str = ""


class LoraEntry(BaseModel):
    name: str
    alias: str = ""
    path: str = ""


# ---------------------------------------------------------------------------
#  Routes
# ---------------------------------------------------------------------------

@app.get("/")
async def root() -> dict[str, str]:
    return {
        "service": "manga-readme",
        "version": __version__,
        "status": "running",
    }


@app.get("/sdapi/v1/options", response_model=OptionsResponse)
async def get_options() -> OptionsResponse:
    """Health check + current model info. Used by frontend to verify connection."""
    return OptionsResponse(sd_model_checkpoint=current_model_repo() or "")


@app.get("/sdapi/v1/sd-models", response_model=list[SDModelEntry])
async def get_sd_models() -> list[SDModelEntry]:
    """Return all registered models (curated + currently loaded)."""
    entries: list[SDModelEntry] = []
    for m in _list_models():
        entries.append(SDModelEntry(
            title=m.repo_id,
            model_name=m.alias,
        ))
    return entries


@app.get("/sdapi/v1/loras", response_model=list[LoraEntry])
async def get_loras() -> list[LoraEntry]:
    """Return LoRA files found in the configured directory."""
    return [LoraEntry(**lr) for lr in list_available_loras()]


@app.post("/sdapi/v1/txt2img", response_model=Txt2ImgResponse)
async def post_txt2img(req: Txt2ImgRequest) -> Txt2ImgResponse:
    """Generate an image via Diffusers and return base64-encoded PNG."""

    # Handle model override
    if req.override_settings and "sd_model_checkpoint" in req.override_settings:
        target = req.override_settings["sd_model_checkpoint"]
        if target and target != current_model_repo():
            load_model(target)

    # Ensure a model is loaded
    if not is_loaded():
        load_model()

    result = txt2img(
        prompt=req.prompt,
        negative_prompt=req.negative_prompt,
        width=req.width,
        height=req.height,
        steps=req.steps,
        cfg_scale=req.cfg_scale,
        seed=req.seed,
        sampler_name=req.sampler_name,
        scheduler=req.scheduler,
    )

    return Txt2ImgResponse(**result)
