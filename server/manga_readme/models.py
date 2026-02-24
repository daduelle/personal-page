"""
Model registry -- curated list of popular Stable Diffusion checkpoints
available through HuggingFace Diffusers.

Each entry stores the HF repo id, a short alias for the CLI, a human-readable
label, the base architecture (``sd15``, ``sd21``, ``sdxl``), and the
recommended default resolution.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ModelEntry:
    """A single model in the registry."""

    repo_id: str
    alias: str
    label: str
    arch: str          # sd15 | sd21 | sdxl
    default_width: int
    default_height: int


# -- Curated models (ordered by recommendation) --------------------------

MODELS: list[ModelEntry] = [
    ModelEntry(
        repo_id="Lykon/dreamshaper-8",
        alias="dreamshaper-8",
        label="DreamShaper 8",
        arch="sd15",
        default_width=512,
        default_height=512,
    ),
    ModelEntry(
        repo_id="stabilityai/stable-diffusion-xl-base-1.0",
        alias="sdxl",
        label="Stable Diffusion XL 1.0",
        arch="sdxl",
        default_width=1024,
        default_height=1024,
    ),
    ModelEntry(
        repo_id="runwayml/stable-diffusion-v1-5",
        alias="sd15",
        label="Stable Diffusion 1.5",
        arch="sd15",
        default_width=512,
        default_height=512,
    ),
    ModelEntry(
        repo_id="stabilityai/stable-diffusion-2-1",
        alias="sd21",
        label="Stable Diffusion 2.1",
        arch="sd21",
        default_width=768,
        default_height=768,
    ),
    ModelEntry(
        repo_id="cagliostrolab/animagine-xl-3.1",
        alias="animagine-xl",
        label="Animagine XL 3.1",
        arch="sdxl",
        default_width=1024,
        default_height=1024,
    ),
    ModelEntry(
        repo_id="SG161222/Realistic_Vision_V5.1_noVAE",
        alias="realistic-vision",
        label="Realistic Vision 5.1",
        arch="sd15",
        default_width=512,
        default_height=512,
    ),
    ModelEntry(
        repo_id="digiplay/AbsoluteReality_v1.8.1",
        alias="absolute-reality",
        label="Absolute Reality 1.8.1",
        arch="sd15",
        default_width=512,
        default_height=512,
    ),
]

# -- Lookup helpers -------------------------------------------------------

_BY_ALIAS: dict[str, ModelEntry] = {m.alias: m for m in MODELS}
_BY_REPO: dict[str, ModelEntry] = {m.repo_id: m for m in MODELS}

DEFAULT_MODEL = MODELS[0]


def get_model(identifier: str) -> ModelEntry | None:
    """Resolve a model by alias, repo_id, or label (case-insensitive)."""
    if identifier in _BY_ALIAS:
        return _BY_ALIAS[identifier]
    if identifier in _BY_REPO:
        return _BY_REPO[identifier]
    lower = identifier.lower()
    for m in MODELS:
        if m.alias.lower() == lower or m.label.lower() == lower:
            return m
    return None


def list_models() -> list[ModelEntry]:
    """Return all registered models."""
    return list(MODELS)
