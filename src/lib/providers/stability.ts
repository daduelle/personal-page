/**
 * Stability AI provider.
 *
 * Supports Stable Image Core, SD3, and Ultra endpoints.
 * Requires an API key from https://platform.stability.ai
 */

import type {
  ImageProvider,
  ProviderConfig,
  GenerateImageParams,
  GenerateImageResult,
} from '@/types';

const API_BASE = 'https://api.stability.ai/v2beta';

export class StabilityProvider implements ImageProvider {
  readonly type = 'stability' as const;
  readonly displayName = 'Stability AI';
  private apiKey: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey;
  }

  async checkConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiKey) {
      return { ok: false, error: 'API key is required' };
    }
    try {
      // Use the user/balance endpoint to validate the key
      const res = await fetch('https://api.stability.ai/v1/user/balance', {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: 'Invalid API key' };
      }
      if (!res.ok) {
        return { ok: false, error: `Stability API error: ${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async generateImage(
    params: GenerateImageParams,
    onStatus?: (msg: string) => void,
  ): Promise<GenerateImageResult> {
    if (!this.apiKey) throw new Error('Stability AI API key is required');

    onStatus?.('Sending request to Stability AI...');

    // Use Stable Image Core for broad compatibility
    const endpoint = `${API_BASE}/stable-image/generate/core`;

    const formData = new FormData();
    formData.append('prompt', params.prompt);
    if (params.negativePrompt) {
      formData.append('negative_prompt', params.negativePrompt);
    }
    formData.append('output_format', 'png');
    formData.append('aspect_ratio', mapToStabilityAspectRatio(params.width, params.height));

    if (params.seed !== undefined && params.seed > 0) {
      formData.append('seed', String(params.seed));
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
      },
      body: formData,
      signal: params.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Stability AI error (${res.status}): ${errText}`);
    }

    const data: { image: string; seed?: number; finish_reason?: string } = await res.json();

    if (!data.image) {
      throw new Error('No image returned from Stability AI');
    }

    const imageDataUrl = `data:image/png;base64,${data.image}`;

    onStatus?.('Generation complete');

    return {
      imageDataUrl,
      seed: data.seed,
      metadata: { finishReason: data.finish_reason },
    };
  }
}

/** Map dimensions to Stability AI aspect ratios */
function mapToStabilityAspectRatio(w: number, h: number): string {
  const ratio = w / h;
  if (ratio > 1.6) return '16:9';
  if (ratio > 1.3) return '3:2';
  if (ratio > 1.1) return '4:3';
  if (ratio > 0.9) return '1:1';
  if (ratio > 0.75) return '3:4';
  if (ratio > 0.6) return '2:3';
  return '9:16';
}
