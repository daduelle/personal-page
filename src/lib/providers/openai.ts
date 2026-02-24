/**
 * OpenAI DALL-E provider.
 *
 * Supports DALL-E 3 and DALL-E 2 image generation.
 * Note: DALL-E 3 does not support negative prompts or step counts.
 * Requires an API key from https://platform.openai.com
 */

import type {
  ImageProvider,
  ProviderConfig,
  GenerateImageParams,
  GenerateImageResult,
} from '@/types';

const API_BASE = 'https://api.openai.com/v1';

export class OpenAIProvider implements ImageProvider {
  readonly type = 'openai' as const;
  readonly displayName = 'OpenAI (DALL-E)';
  private apiKey: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey;
  }

  async checkConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiKey) {
      return { ok: false, error: 'API key is required' };
    }
    try {
      const res = await fetch(`${API_BASE}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 401) return { ok: false, error: 'Invalid API key' };
      if (!res.ok) return { ok: false, error: `OpenAI API error: ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async generateImage(
    params: GenerateImageParams,
    onStatus?: (msg: string) => void,
  ): Promise<GenerateImageResult> {
    if (!this.apiKey) throw new Error('OpenAI API key is required');

    onStatus?.('Sending request to OpenAI...');

    // DALL-E 3 supports limited sizes
    const size = mapToDALLESize(params.width, params.height);

    const body = {
      model: 'dall-e-3',
      prompt: params.prompt,
      n: 1,
      size,
      quality: 'standard',
      response_format: 'b64_json',
    };

    const res = await fetch(`${API_BASE}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: { message: res.statusText } }));
      throw new Error(`OpenAI error: ${errBody?.error?.message ?? res.statusText}`);
    }

    const data: { data: { b64_json: string; revised_prompt?: string }[] } = await res.json();

    if (!data.data?.[0]?.b64_json) {
      throw new Error('No image returned from OpenAI');
    }

    const imageDataUrl = `data:image/png;base64,${data.data[0].b64_json}`;

    onStatus?.('Generation complete');

    return {
      imageDataUrl,
      metadata: { revisedPrompt: data.data[0].revised_prompt },
    };
  }
}

/** Map arbitrary dimensions to the closest DALL-E 3 supported size */
function mapToDALLESize(w: number, h: number): string {
  const ratio = w / h;
  if (ratio > 1.3) return '1792x1024';   // Landscape
  if (ratio < 0.77) return '1024x1792';  // Portrait
  return '1024x1024';                     // Square
}
