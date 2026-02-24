/**
 * Replicate provider.
 *
 * Supports any image generation model on Replicate via predictions API.
 * Requires an API token from https://replicate.com/account/api-tokens
 *
 * Default model: stability-ai/stable-diffusion (SDXL)
 * Users can specify a model in providerConfig.selectedModel using
 * the format "owner/model" or "owner/model:version".
 */

import type {
  ImageProvider,
  ProviderConfig,
  GenerateImageParams,
  GenerateImageResult,
} from '@/types';

const API_BASE = 'https://api.replicate.com/v1';
const DEFAULT_MODEL = 'stability-ai/sdxl:7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc';

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 120; // 4 min

export class ReplicateProvider implements ImageProvider {
  readonly type = 'replicate' as const;
  readonly displayName = 'Replicate';
  private apiKey: string;
  private model: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.selectedModel || DEFAULT_MODEL;
  }

  async checkConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiKey) {
      return { ok: false, error: 'API token is required' };
    }
    try {
      const res = await fetch(`${API_BASE}/account`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 401) return { ok: false, error: 'Invalid API token' };
      if (!res.ok) return { ok: false, error: `Replicate API error: ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async generateImage(
    params: GenerateImageParams,
    onStatus?: (msg: string) => void,
  ): Promise<GenerateImageResult> {
    if (!this.apiKey) throw new Error('Replicate API token is required');

    onStatus?.('Creating prediction on Replicate...');

    // Determine model version
    const [modelPath, version] = this.model.includes(':')
      ? this.model.split(':')
      : [this.model, undefined];

    const input: Record<string, unknown> = {
      prompt: params.prompt,
      width: clampSize(params.width),
      height: clampSize(params.height),
    };

    if (params.negativePrompt) input.negative_prompt = params.negativePrompt;
    if (params.steps) input.num_inference_steps = params.steps;
    if (params.guidanceScale) input.guidance_scale = params.guidanceScale;
    if (params.seed !== undefined && params.seed > 0) input.seed = params.seed;

    // Create prediction
    const body: Record<string, unknown> = { input };

    if (version) {
      body.version = version;
    } else {
      body.model = modelPath;
    }

    const createRes = await fetch(`${API_BASE}/predictions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        Prefer: 'wait',
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!createRes.ok) {
      const errBody = await createRes.json().catch(() => ({ detail: createRes.statusText }));
      throw new Error(`Replicate error: ${errBody.detail ?? createRes.statusText}`);
    }

    let prediction: ReplicatePrediction = await createRes.json();

    // Poll until complete
    let attempts = 0;
    while (prediction.status !== 'succeeded' && prediction.status !== 'failed') {
      if (attempts++ >= MAX_POLL_ATTEMPTS) {
        throw new Error('Replicate prediction timed out');
      }

      onStatus?.(`Waiting for generation (${prediction.status})...`);

      await sleep(POLL_INTERVAL_MS);

      const pollRes = await fetch(prediction.urls.get, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: params.signal,
      });

      if (!pollRes.ok) throw new Error(`Replicate poll error: ${pollRes.status}`);
      prediction = await pollRes.json();
    }

    if (prediction.status === 'failed') {
      throw new Error(`Replicate prediction failed: ${prediction.error ?? 'Unknown error'}`);
    }

    // Output is usually an array of image URLs
    const output = prediction.output;
    const imageUrl = Array.isArray(output) ? output[0] : output;

    if (!imageUrl || typeof imageUrl !== 'string') {
      throw new Error('No image URL in Replicate output');
    }

    onStatus?.('Downloading generated image...');

    // Download and convert to data URL
    const imgRes = await fetch(imageUrl, { signal: params.signal });
    if (!imgRes.ok) throw new Error('Failed to download generated image');

    const blob = await imgRes.blob();
    const imageDataUrl = await blobToDataUrl(blob);

    onStatus?.('Generation complete');

    return {
      imageDataUrl,
      seed: prediction.output_seed,
      metadata: {
        predictionId: prediction.id,
        model: this.model,
      },
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: unknown;
  output_seed?: number;
  error?: string;
  urls: { get: string; cancel: string };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** Clamp size to multiples of 8, within typical model limits */
function clampSize(v: number): number {
  const clamped = Math.round(v / 8) * 8;
  return Math.max(256, Math.min(clamped, 1536));
}
