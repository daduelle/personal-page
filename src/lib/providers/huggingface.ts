/**
 * HuggingFace Inference API provider.
 *
 * Uses the serverless Inference API for text-to-image generation.
 * An API token is optional but recommended for higher rate limits.
 *
 * Handles model warm-up (503 retries) and rate limiting automatically.
 *
 * @see https://huggingface.co/docs/api-inference
 */

import type {
  ImageProvider,
  ProviderConfig,
  GenerateImageParams,
  GenerateImageResult,
} from '@/types';

const HF_DEFAULT_BASE = 'https://api-inference.huggingface.co';
const HF_ROUTER_BASE = 'https://router.huggingface.co/hf-inference';
const TOKEN_KEY = 'manga-readme-hf-token';
const MAX_RETRIES = 3;

const DEFAULT_HF_MODELS = [
  'stabilityai/stable-diffusion-xl-base-1.0',
  'runwayml/stable-diffusion-v1-5',
  'stabilityai/stable-diffusion-2-1',
];

export class HuggingFaceProvider implements ImageProvider {
  readonly type = 'huggingface' as const;
  readonly displayName = 'HuggingFace';
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey || getStoredToken();
    this.model = config.selectedModel || DEFAULT_HF_MODELS[0];
    this.baseUrl = (config.baseUrl || HF_DEFAULT_BASE).trim();
  }

  async checkConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

      const { response: res } = await this.requestWithFallback(
        this.getCandidateModelUrls(),
        {
        method: 'POST',
        headers,
        body: JSON.stringify({
          inputs: 'test',
          parameters: { num_inference_steps: 1, width: 64, height: 64 },
        }),
          signal: timeoutSignal(15000),
        },
      );

      if (res.status === 401) return { ok: false, error: 'Invalid API token' };
      // 503 means model is loading but API is reachable
      if (res.ok || res.status === 503) return { ok: true };

      return { ok: false, error: `HuggingFace API error: ${res.status}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async listModels(): Promise<string[]> {
    return DEFAULT_HF_MODELS;
  }

  async generateImage(
    params: GenerateImageParams,
    onStatus?: (msg: string) => void,
  ): Promise<GenerateImageResult> {
    const urls = this.getCandidateModelUrls();

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const body = {
      inputs: params.prompt,
      parameters: {
        negative_prompt: params.negativePrompt ?? '',
        guidance_scale: params.guidanceScale ?? 7.5,
        num_inference_steps: params.steps ?? 30,
        width: params.width,
        height: params.height,
        ...(params.seed !== undefined && params.seed >= 0 ? { seed: params.seed } : {}),
      },
    };

    let lastError = '';

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (params.signal?.aborted) {
        throw new DOMException('Generation cancelled', 'AbortError');
      }

      try {
        onStatus?.(attempt === 0 ? 'Sending request to HuggingFace...' : `Retrying (attempt ${attempt + 1})...`);

        const { response } = await this.requestWithFallback(urls, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: params.signal,
        });

        // Success - response is an image blob
        if (response.ok) {
          const contentType = response.headers.get('content-type') ?? '';

          if (contentType.startsWith('image/')) {
            const blob = await response.blob();
            const imageDataUrl = await blobToDataUrl(blob);
            onStatus?.('Generation complete');
            return { imageDataUrl };
          }

          // Some models return JSON with a base64 image
          const json = await response.json();
          if (Array.isArray(json) && json[0]?.image) {
            const imageDataUrl = `data:image/png;base64,${json[0].image}`;
            return { imageDataUrl };
          }

          throw new Error('Unexpected response format from HuggingFace API');
        }

        // Model is loading (cold start) - wait and retry
        if (response.status === 503) {
          const json = await response.json().catch(() => ({} as { estimated_time?: number; error?: string }));
          const waitTime = Math.min(json.estimated_time ?? 20, 60);
          lastError = json.error ?? 'Model is loading';

          onStatus?.(`Model is warming up... (estimated ${Math.ceil(waitTime)}s)`);
          await sleep(waitTime * 1000, params.signal);
          continue;
        }

        // Rate limited
        if (response.status === 429) {
          lastError = 'Rate limited';
          onStatus?.('Rate limited, waiting...');
          await sleep(10_000, params.signal);
          continue;
        }

        // Auth error
        if (response.status === 401) {
          throw new Error('Invalid API token. Remove the token to use the free tier, or provide a valid HuggingFace token.');
        }

        const errBody = await response.text().catch(() => '');
        throw new Error(`HuggingFace API error (${response.status}): ${errBody || response.statusText}`);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        if (attempt === MAX_RETRIES - 1) throw error;
        lastError = normalizeFetchError(error);
        onStatus?.(`Error: ${lastError}. Retrying...`);
        await sleep(3000, params.signal);
      }
    }

    throw new Error(`Failed after ${MAX_RETRIES} attempts: ${lastError}`);
  }

  private getCandidateModelUrls(): string[] {
    const normalizedBase = this.baseUrl.replace(/\/$/, '');

    const providedUrl = normalizedBase.includes('/models/')
      ? normalizedBase
      : normalizedBase.endsWith('/models')
        ? `${normalizedBase}/${this.model}`
        : `${normalizedBase}/models/${this.model}`;

    return Array.from(new Set([
      providedUrl,
      `${HF_DEFAULT_BASE}/models/${this.model}`,
      `${HF_ROUTER_BASE}/models/${this.model}`,
    ]));
  }

  private async requestWithFallback(
    urls: string[],
    init: RequestInit,
  ): Promise<{ response: Response; url: string }> {
    let lastNetworkError = '';

    for (const url of urls) {
      try {
        const response = await fetch(url, init);

        if (response.status === 404 || response.status === 405) {
          continue;
        }

        return { response, url };
      } catch (error) {
        lastNetworkError = normalizeFetchError(error);
      }
    }

    throw new Error(
      lastNetworkError ||
      'Failed to fetch HuggingFace endpoint. Check internet access, CORS, firewall/proxy, or set a custom HuggingFace base URL.',
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Token Management                                                  */
/* ------------------------------------------------------------------ */

export function getStoredToken(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function setStoredToken(token: string): void {
  if (typeof window === 'undefined') return;
  if (token.trim()) {
    localStorage.setItem(TOKEN_KEY, token.trim());
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  return undefined;
}

function normalizeFetchError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/failed to fetch/i.test(message) || /networkerror/i.test(message)) {
    return 'Failed to fetch (network/CORS). Verify connection, disable blocking extensions, and try another HuggingFace endpoint.';
  }
  return message;
}
