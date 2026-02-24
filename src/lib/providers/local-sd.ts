/**
 * Local Stable Diffusion provider — Automatic1111 / Forge / SD.Next API.
 *
 * Connects to a locally running SD WebUI instance.
 * Supports model switching, LoRA loading, and full txt2img parameters.
 *
 * The user must start the server with API + CORS enabled:
 *   python launch.py --api --cors-allow-origins=http://localhost:3000
 */

import type {
  ImageProvider,
  ProviderConfig,
  GenerateImageParams,
  GenerateImageResult,
  LoraInfo,
} from '@/types';

export class LocalSDProvider implements ImageProvider {
  readonly type = 'local-sd' as const;
  readonly displayName = 'Local Stable Diffusion';
  private baseUrl: string;
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.baseUrl = (config.baseUrl || 'http://127.0.0.1:7860').replace(/\/+$/, '');
  }

  // ---- Connection check ----

  async checkConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/sdapi/v1/options`, {
        method: 'GET',
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        return { ok: false, error: `Server responded with ${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        return {
          ok: false,
          error: 'Cannot reach server. Is it running? Did you enable --api and --cors-allow-origins?',
        };
      }
      return { ok: false, error: msg };
    }
  }

  // ---- Model listing ----

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/sdapi/v1/sd-models`);
    if (!res.ok) throw new Error(`Failed to list models: ${res.status}`);
    const models: { title: string; model_name: string }[] = await res.json();
    return models.map((m) => m.title);
  }

  // ---- LoRA listing ----

  async listLoras(): Promise<LoraInfo[]> {
    const res = await fetch(`${this.baseUrl}/sdapi/v1/loras`);
    if (!res.ok) throw new Error(`Failed to list LoRAs: ${res.status}`);
    const loras: { name: string; alias: string; path: string }[] = await res.json();
    return loras.map((l) => ({ name: l.name, alias: l.alias, path: l.path }));
  }

  // ---- Image generation ----

  async generateImage(
    params: GenerateImageParams,
    onStatus?: (msg: string) => void,
  ): Promise<GenerateImageResult> {
    // Build prompt with LoRA tags
    let prompt = params.prompt;
    const loras = params.loras ?? this.config.loras ?? [];
    for (const lora of loras) {
      prompt += ` <lora:${lora.name}:${lora.weight}>`;
    }

    onStatus?.('Sending request to local SD server...');

    const body = {
      prompt,
      negative_prompt: params.negativePrompt ?? '',
      width: params.width,
      height: params.height,
      steps: params.steps,
      cfg_scale: params.guidanceScale,
      seed: params.seed ?? -1,
      sampler_name: 'DPM++ 2M',
      scheduler: 'Karras',
      batch_size: 1,
      n_iter: 1,
      // Override model if specified
      ...(params.model ? { override_settings: { sd_model_checkpoint: params.model } } : {}),
    };

    const res = await fetch(`${this.baseUrl}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Local SD error (${res.status}): ${errText || res.statusText}`);
    }

    const data: { images: string[]; parameters: Record<string, unknown>; info: string } =
      await res.json();

    if (!data.images || data.images.length === 0) {
      throw new Error('No images returned from local SD server');
    }

    const imageDataUrl = `data:image/png;base64,${data.images[0]}`;

    // Parse seed from info
    let seed: number | undefined;
    try {
      const info = JSON.parse(data.info);
      seed = info.seed;
    } catch {
      // Ignore parse errors
    }

    onStatus?.('Generation complete');

    return { imageDataUrl, seed, metadata: data.parameters as Record<string, unknown> };
  }
}
