# manga-readme

Local AI image-generation server for **MangaREADME Generator**.

Powered by [HuggingFace Diffusers](https://huggingface.co/docs/diffusers). Exposes an
A1111-compatible REST API so the MangaREADME frontend connects with zero extra
configuration.

## Quick Start

```bash
pip install manga-readme
manga-readme serve
```

The server starts on `http://127.0.0.1:7860` by default. Open the MangaREADME
frontend and select **Local Server (manga-readme)** as the provider.

## Models

Pre-configured models (downloaded on first use):

| Alias | Architecture | Resolution | Repo |
|-------|-------------|------------|------|
| dreamshaper-8 | SD 1.5 | 512x512 | Lykon/dreamshaper-8 |
| sdxl | SDXL | 1024x1024 | stabilityai/stable-diffusion-xl-base-1.0 |
| sd15 | SD 1.5 | 512x512 | runwayml/stable-diffusion-v1-5 |
| sd21 | SD 2.1 | 768x768 | stabilityai/stable-diffusion-2-1 |
| animagine-xl | SDXL | 1024x1024 | cagliostrolab/animagine-xl-3.1 |
| realistic-vision | SD 1.5 | 512x512 | SG161222/Realistic_Vision_V5.1_noVAE |
| absolute-reality | SD 1.5 | 512x512 | digiplay/AbsoluteReality_v1.8.1 |

```bash
manga-readme serve --model sdxl
manga-readme serve --model Lykon/dreamshaper-8
manga-readme list-models
```

## LoRA Support

Place `.safetensors` or `.pt` LoRA files in a directory and point the server
at it:

```bash
manga-readme serve --lora-dir ./my-loras
```

LoRAs are applied via prompt tags: `<lora:name:0.7>`. The frontend LoRA
picker sends these tags automatically.

## GPU

A CUDA GPU with 6 GB+ VRAM is recommended. For CUDA support, install
PyTorch with the correct CUDA version **before** installing manga-readme:

```bash
pip install torch --index-url https://download.pytorch.org/whl/cu121
pip install manga-readme
```

CPU inference works but is very slow.

## License

MIT
