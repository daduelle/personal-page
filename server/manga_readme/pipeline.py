"""
Diffusers pipeline manager.

Handles loading / switching checkpoints, applying LoRAs, and running
txt2img inference.  Only one pipeline is kept in memory at a time.
"""

from __future__ import annotations

import gc
import json
import logging
import os
import random
import re
from io import BytesIO
from base64 import b64encode
from pathlib import Path
from typing import Any

import torch
from PIL import Image

from manga_readme.models import DEFAULT_MODEL, ModelEntry, get_model

logger = logging.getLogger("manga_readme.pipeline")

# ---------------------------------------------------------------------------
#  Globals
# ---------------------------------------------------------------------------

_pipe: Any | None = None
_current_repo: str | None = None
_active_loras: list[str] = []
_lora_dir: Path = Path("./loras")
_device: str = "cuda" if torch.cuda.is_available() else "cpu"
_dtype = torch.float16 if _device == "cuda" else torch.float32


# ---------------------------------------------------------------------------
#  Public helpers
# ---------------------------------------------------------------------------

def configure(*, lora_dir: str | Path | None = None) -> None:
    """Set global options before first load."""
    global _lora_dir
    if lora_dir is not None:
        _lora_dir = Path(lora_dir)
        _lora_dir.mkdir(parents=True, exist_ok=True)


def get_device() -> str:
    return _device


def is_loaded() -> bool:
    return _pipe is not None


def current_model_repo() -> str | None:
    return _current_repo


# ---------------------------------------------------------------------------
#  Pipeline lifecycle
# ---------------------------------------------------------------------------

def load_model(identifier: str | None = None, *, half: bool = True) -> str:
    """
    Load a Diffusers pipeline into memory.

    ``identifier`` can be an alias (``dreamshaper-8``), a HuggingFace repo id
    (``Lykon/dreamshaper-8``), or ``None`` to load the default model.

    Returns the repo_id that was loaded.
    """
    global _pipe, _current_repo, _active_loras

    entry: ModelEntry | None = None
    if identifier:
        entry = get_model(identifier)

    if entry is None and identifier:
        # Treat as raw HF repo id
        repo_id = identifier
    elif entry:
        repo_id = entry.repo_id
    else:
        entry = DEFAULT_MODEL
        repo_id = entry.repo_id

    if _current_repo == repo_id and _pipe is not None:
        logger.info("Model %s already loaded -- skipping.", repo_id)
        return repo_id

    _unload()

    logger.info("Loading model %s on %s (%s)...", repo_id, _device, _dtype)

    arch = entry.arch if entry else _guess_arch(repo_id)

    if arch == "sdxl":
        from diffusers import StableDiffusionXLPipeline

        _pipe = StableDiffusionXLPipeline.from_pretrained(
            repo_id,
            torch_dtype=_dtype if half else torch.float32,
            use_safetensors=True,
            variant="fp16" if half and _device == "cuda" else None,
        )
    else:
        from diffusers import StableDiffusionPipeline

        _pipe = StableDiffusionPipeline.from_pretrained(
            repo_id,
            torch_dtype=_dtype if half else torch.float32,
            use_safetensors=True,
            variant="fp16" if half and _device == "cuda" else None,
        )

    _pipe.to(_device)

    # Enable memory optimisations when available
    if _device == "cuda":
        try:
            _pipe.enable_xformers_memory_efficient_attention()
            logger.info("xformers memory-efficient attention enabled.")
        except Exception:
            try:
                from diffusers.utils import is_torch_version
                if is_torch_version(">=", "2.0.0"):
                    _pipe.unet = torch.compile(_pipe.unet, mode="reduce-overhead", fullgraph=True)
                    logger.info("torch.compile applied to UNet.")
            except Exception:
                pass

    _pipe.safety_checker = None  # Disable NSFW filter -- user-owned backend
    _current_repo = repo_id
    _active_loras = []
    logger.info("Model %s loaded successfully.", repo_id)
    return repo_id


def _unload() -> None:
    global _pipe, _current_repo, _active_loras
    if _pipe is not None:
        del _pipe
        _pipe = None
        _current_repo = None
        _active_loras = []
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


def _guess_arch(repo_id: str) -> str:
    lower = repo_id.lower()
    if "xl" in lower or "sdxl" in lower:
        return "sdxl"
    if "2-1" in lower or "2.1" in lower:
        return "sd21"
    return "sd15"


# ---------------------------------------------------------------------------
#  LoRA helpers
# ---------------------------------------------------------------------------

_LORA_TAG_RE = re.compile(r"<lora:([^:>]+):([0-9.]+)>")


def _parse_lora_tags(prompt: str) -> tuple[str, list[tuple[str, float]]]:
    """
    Extract ``<lora:name:weight>`` tags from a prompt.

    Returns the cleaned prompt and a list of ``(name, weight)`` tuples.
    """
    loras: list[tuple[str, float]] = []

    def _collect(m: re.Match[str]) -> str:
        name = m.group(1).strip()
        try:
            weight = float(m.group(2))
        except ValueError:
            weight = 0.7
        loras.append((name, weight))
        return ""

    cleaned = _LORA_TAG_RE.sub(_collect, prompt).strip()
    return cleaned, loras


def _apply_loras(loras: list[tuple[str, float]]) -> None:
    """Load requested LoRAs into the active pipeline."""
    global _active_loras

    if _pipe is None:
        return

    # Unload any previously loaded LoRAs
    if _active_loras:
        try:
            _pipe.unload_lora_weights()
        except Exception:
            pass
        _active_loras = []

    if not loras:
        return

    adapter_names: list[str] = []
    adapter_weights: list[float] = []

    for name, weight in loras:
        path = _resolve_lora(name)
        if path is None:
            logger.warning("LoRA '%s' not found -- skipping.", name)
            continue
        adapter_name = Path(path).stem
        try:
            _pipe.load_lora_weights(str(path), adapter_name=adapter_name)
            adapter_names.append(adapter_name)
            adapter_weights.append(weight)
            logger.info("Loaded LoRA: %s (weight=%.2f)", adapter_name, weight)
        except Exception as exc:
            logger.warning("Failed to load LoRA '%s': %s", name, exc)

    if adapter_names:
        try:
            _pipe.set_adapters(adapter_names, adapter_weights=adapter_weights)
        except Exception:
            pass
        _active_loras = adapter_names


def _resolve_lora(name: str) -> str | None:
    """Find a LoRA file by name in the configured lora_dir."""
    if not _lora_dir.exists():
        return None

    for ext in (".safetensors", ".pt", ".bin", ".ckpt"):
        candidate = _lora_dir / f"{name}{ext}"
        if candidate.is_file():
            return str(candidate)

    # Also search sub-directories one level deep
    for child in _lora_dir.iterdir():
        if child.is_dir():
            for ext in (".safetensors", ".pt", ".bin", ".ckpt"):
                candidate = child / f"{name}{ext}"
                if candidate.is_file():
                    return str(candidate)

    # Try treating name as HF repo id (e.g. user/lora-name)
    if "/" in name:
        return name  # diffusers can load directly from HF Hub

    return None


def list_available_loras() -> list[dict[str, str]]:
    """List LoRA files found in the configured directory."""
    results: list[dict[str, str]] = []
    if not _lora_dir.exists():
        return results
    for f in sorted(_lora_dir.rglob("*")):
        if f.suffix in (".safetensors", ".pt", ".bin", ".ckpt"):
            results.append({
                "name": f.stem,
                "alias": f.stem,
                "path": str(f),
            })
    return results


# ---------------------------------------------------------------------------
#  txt2img
# ---------------------------------------------------------------------------

SCHEDULER_MAP: dict[str, str] = {
    "DPM++ 2M": "DPMSolverMultistepScheduler",
    "DPM++ 2M Karras": "DPMSolverMultistepScheduler",
    "DPM++ 2M SDE": "DPMSolverMultistepScheduler",
    "DPM++ 2M SDE Karras": "DPMSolverMultistepScheduler",
    "DPM++ SDE": "DPMSolverSinglestepScheduler",
    "DPM++ SDE Karras": "DPMSolverSinglestepScheduler",
    "Euler": "EulerDiscreteScheduler",
    "Euler a": "EulerAncestralDiscreteScheduler",
    "DDIM": "DDIMScheduler",
    "LMS": "LMSDiscreteScheduler",
    "PNDM": "PNDMScheduler",
}


def _set_scheduler(name: str | None, use_karras: bool = False) -> None:
    if _pipe is None or not name:
        return

    cls_name = SCHEDULER_MAP.get(name)
    if cls_name is None:
        return

    import diffusers.schedulers as sched_module
    cls = getattr(sched_module, cls_name, None)
    if cls is None:
        return

    kwargs: dict[str, Any] = {}
    if "karras" in (name or "").lower() or use_karras:
        kwargs["use_karras_sigmas"] = True
    if "sde" in (name or "").lower():
        kwargs["algorithm_type"] = "sde-dpmsolver++"

    _pipe.scheduler = cls.from_config(_pipe.scheduler.config, **kwargs)


def txt2img(
    *,
    prompt: str,
    negative_prompt: str = "",
    width: int = 512,
    height: int = 512,
    steps: int = 30,
    cfg_scale: float = 7.5,
    seed: int = -1,
    sampler_name: str | None = "DPM++ 2M",
    scheduler: str | None = None,
) -> dict[str, Any]:
    """
    Run txt2img and return an A1111-compatible response dict.

    Returns ``{"images": [<base64>], "parameters": {...}, "info": "<json>"}``
    """
    if _pipe is None:
        raise RuntimeError("No model loaded. Call load_model() first.")

    # Parse LoRA tags from prompt
    cleaned_prompt, loras = _parse_lora_tags(prompt)
    if loras:
        _apply_loras(loras)

    # Scheduler
    use_karras = (scheduler or "").lower() == "karras" or "karras" in (sampler_name or "").lower()
    _set_scheduler(sampler_name, use_karras=use_karras)

    # Seed
    if seed < 0:
        seed = random.randint(0, 2**32 - 1)
    generator = torch.Generator(device=_device).manual_seed(seed)

    logger.info(
        "txt2img: %dx%d, steps=%d, cfg=%.1f, seed=%d, sampler=%s",
        width, height, steps, cfg_scale, seed, sampler_name,
    )

    result = _pipe(
        prompt=cleaned_prompt,
        negative_prompt=negative_prompt,
        width=width,
        height=height,
        num_inference_steps=steps,
        guidance_scale=cfg_scale,
        generator=generator,
    )

    image: Image.Image = result.images[0]
    buf = BytesIO()
    image.save(buf, format="PNG")
    b64 = b64encode(buf.getvalue()).decode("ascii")

    info = json.dumps({
        "prompt": cleaned_prompt,
        "negative_prompt": negative_prompt,
        "seed": seed,
        "steps": steps,
        "cfg_scale": cfg_scale,
        "width": width,
        "height": height,
        "sampler_name": sampler_name or "",
    })

    return {
        "images": [b64],
        "parameters": {
            "prompt": cleaned_prompt,
            "negative_prompt": negative_prompt,
            "seed": seed,
            "steps": steps,
            "cfg_scale": cfg_scale,
            "width": width,
            "height": height,
        },
        "info": info,
    }
