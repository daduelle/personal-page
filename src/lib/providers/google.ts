/**
 * Google Gemini image provider ("Nano Banana").
 *
 * Uses Gemini `generateContent` with image output parts.
 * Requires a Google AI Studio / Gemini API key.
 */

import type {
  ImageProvider,
  ProviderConfig,
  GenerateImageParams,
  GenerateImageResult,
} from '@/types';

const GOOGLE_DEFAULT_BASE = 'https://generativelanguage.googleapis.com';
const API_VERSIONS = ['v1beta', 'v1'] as const;
const DEFAULT_MODEL = 'gemini-2.0-flash-preview-image-generation';
const FALLBACK_MODELS = [
  'gemini-2.0-flash-preview-image-generation',
  'gemini-2.0-flash-exp-image-generation',
  'gemini-2.5-flash-image-preview',
  'gemini-2.5-flash',
];

export class GoogleProvider implements ImageProvider {
  readonly type = 'google' as const;
  readonly displayName = 'Google (Nano Banana)';

  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey.trim();
    this.baseUrl = (config.baseUrl || GOOGLE_DEFAULT_BASE).trim().replace(/\/$/, '');
    this.model = config.selectedModel || DEFAULT_MODEL;
  }

  async checkConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiKey) {
      return { ok: false, error: 'Google API key is required' };
    }

    try {
      const discovery = await this.discoverModels();
      if (!discovery.ok) {
        return { ok: false, error: discovery.error };
      }

      return { ok: true };
    } catch (err) {
      return { ok: false, error: normalizeError(err) };
    }
  }

  async listModels(): Promise<string[]> {
    if (!this.apiKey) {
      return [DEFAULT_MODEL];
    }

    try {
      const discovery = await this.discoverModels();
      if (!discovery.ok) {
        return [DEFAULT_MODEL, ...FALLBACK_MODELS.filter((m) => m !== DEFAULT_MODEL)];
      }
      const imageModels = discovery.models
        .filter((name) => /image|flash|vision|gemini/i.test(name));
      return unique([
        this.model,
        DEFAULT_MODEL,
        ...imageModels,
        ...FALLBACK_MODELS,
      ]);
    } catch {
      return [DEFAULT_MODEL, ...FALLBACK_MODELS.filter((m) => m !== DEFAULT_MODEL)];
    }
  }

  async generateImage(
    params: GenerateImageParams,
    onStatus?: (msg: string) => void,
  ): Promise<GenerateImageResult> {
    if (!this.apiKey) {
      throw new Error('Google API key is required');
    }

    onStatus?.('Sending request to Google Gemini...');

    const prompt = buildPrompt(params);

    const body = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
    };

    const models = await this.listModels();
    const targets = buildTargets(models);
    let lastError = '';

    for (const target of targets) {
      onStatus?.(`Trying Google model: ${target.model} (${target.version})...`);

      const res = await fetch(this.buildGenerateUrl(target.model, target.version), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: params.signal,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({} as { error?: { message?: string } }));
        const message = errBody.error?.message ?? res.statusText;

        if (res.status === 401 || res.status === 403) {
          throw new Error('Invalid Google API key or missing permission for Gemini API.');
        }

        if (isRecoverableModelError(res.status, message)) {
          lastError = `Google API error (${res.status}): ${message}`;
          continue;
        }

        throw new Error(`Google API error (${res.status}): ${message}`);
      }

      const data: GeminiGenerateResponse = await res.json();
      const part = data.candidates?.[0]?.content?.parts?.find((p) => Boolean(p.inlineData?.data));

      if (!part?.inlineData?.data) {
        const blockedReason = data.promptFeedback?.blockReason;
        const fallbackText = data.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;

        if (blockedReason) {
          throw new Error(`Google blocked this prompt: ${blockedReason}`);
        }

        if (fallbackText) {
          lastError = fallbackText;
          continue;
        }

        lastError = 'No image returned from Google Gemini';
        continue;
      }

      const mime = part.inlineData.mimeType || 'image/png';
      this.model = target.model;
      onStatus?.('Generation complete');

      return {
        imageDataUrl: `data:${mime};base64,${part.inlineData.data}`,
        metadata: { model: target.model, apiVersion: target.version },
      };
    }

    throw new Error(
      lastError ||
        'No compatible Google Gemini image model was found for your API key. Use Test Connection and select a model from the dropdown.',
    );
  }

  private async discoverModels(): Promise<
    | { ok: true; models: string[] }
    | { ok: false; error: string }
  > {
    let lastError = 'Unable to list Google Gemini models';

    for (const version of API_VERSIONS) {
      try {
        const res = await fetch(this.buildModelsUrl(version), {
          method: 'GET',
          signal: timeoutSignal(10000),
        });

        if (res.status === 401 || res.status === 403) {
          return { ok: false, error: 'Invalid API key or permission denied' };
        }

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({} as { error?: { message?: string } }));
          lastError = errBody.error?.message ?? `Google API error: ${res.status}`;
          continue;
        }

        const data: { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> } = await res.json();
        const compatible = (data.models ?? [])
          .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
          .map((m) => (m.name ?? '').replace(/^models\//, ''))
          .filter(Boolean);

        return { ok: true, models: unique(compatible) };
      } catch (err) {
        lastError = normalizeError(err);
      }
    }

    return { ok: false, error: lastError };
  }

  private buildModelsUrl(version: (typeof API_VERSIONS)[number]): string {
    return `${this.baseUrl}/${version}/models?key=${encodeURIComponent(this.apiKey)}`;
  }

  private buildGenerateUrl(modelName: string, version: (typeof API_VERSIONS)[number]): string {
    const model = encodeURIComponent(modelName);
    return `${this.baseUrl}/${version}/models/${model}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
  }
}

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: {
          mimeType?: string;
          data?: string;
        };
      }>;
    };
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
}

function buildPrompt(params: GenerateImageParams): string {
  const instructions = [
    `Create a manga-style image at approximately ${params.width}x${params.height}.`,
    `Main prompt: ${params.prompt}`,
  ];

  if (params.negativePrompt?.trim()) {
    instructions.push(`Avoid: ${params.negativePrompt.trim()}`);
  }

  if (typeof params.guidanceScale === 'number') {
    instructions.push(`Guidance preference: ${params.guidanceScale}.`);
  }

  if (typeof params.steps === 'number') {
    instructions.push(`Detail level target (steps): ${params.steps}.`);
  }

  if (typeof params.seed === 'number' && params.seed >= 0) {
    instructions.push(`Seed reference: ${params.seed}.`);
  }

  return instructions.join('\n');
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  return undefined;
}

function normalizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/failed to fetch/i.test(message) || /networkerror/i.test(message)) {
    return 'Failed to fetch Google API (network/CORS). Check internet/firewall and base URL.';
  }
  return message;
}

function isRecoverableModelError(status: number, message: string): boolean {
  if (status !== 404 && status !== 400) {
    return false;
  }
  const text = message.toLowerCase();
  return (
    text.includes('not found') ||
    text.includes('not supported') ||
    text.includes('unsupported') ||
    text.includes('generatecontent') ||
    text.includes('model')
  );
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function buildTargets(models: string[]): Array<{ model: string; version: (typeof API_VERSIONS)[number] }> {
  const orderedModels = unique([DEFAULT_MODEL, ...models, ...FALLBACK_MODELS]);
  const targets: Array<{ model: string; version: (typeof API_VERSIONS)[number] }> = [];

  for (const model of orderedModels) {
    for (const version of API_VERSIONS) {
      targets.push({ model, version });
    }
  }

  return targets;
}
