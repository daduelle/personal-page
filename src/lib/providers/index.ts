/**
 * Provider type re-exports and shared helpers.
 *
 * Every image-generation provider implements the `ImageProvider` interface
 * defined in `@/types`. This module provides a factory to instantiate them
 * from a `ProviderConfig`.
 */

import type { ImageProvider, ProviderConfig } from '@/types';
import { LocalSDProvider } from './local-sd';
import { OpenAIProvider } from './openai';
import { GoogleProvider } from './google';
import { StabilityProvider } from './stability';
import { ReplicateProvider } from './replicate';
import { HuggingFaceProvider } from './huggingface';

/**
 * Create an `ImageProvider` instance from a saved configuration.
 */
export function createProvider(config: ProviderConfig): ImageProvider {
  switch (config.type) {
    case 'local-sd':
      return new LocalSDProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    case 'google':
      return new GoogleProvider(config);
    case 'stability':
      return new StabilityProvider(config);
    case 'replicate':
      return new ReplicateProvider(config);
    case 'huggingface':
      return new HuggingFaceProvider(config);
    default:
      throw new Error(`Unknown provider type: ${(config as ProviderConfig).type}`);
  }
}

/** Human-readable labels for each provider */
export const PROVIDER_META: Record<
  ProviderConfig['type'],
  { label: string; description: string; docsUrl: string }
> = {
  'local-sd': {
    label: 'Local Server (manga-readme)',
    description: 'Run Stable Diffusion locally via manga-readme (Diffusers) or Automatic1111/Forge. Full privacy, LoRA support.',
    docsUrl: 'https://github.com/rodrigoguedes09/personal-page/tree/main/server',
  },
  openai: {
    label: 'OpenAI (DALL-E)',
    description: 'Use OpenAI DALL-E 3 for high-quality image generation. Requires an API key.',
    docsUrl: 'https://platform.openai.com/docs/guides/images',
  },
  google: {
    label: 'Google (Nano Banana)',
    description: 'Use Google Gemini image generation API (Nano Banana). Requires an API key.',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/image-generation',
  },
  stability: {
    label: 'Stability AI',
    description: 'Stability AI image generation API (SD3, SDXL, Ultra). Requires an API key.',
    docsUrl: 'https://platform.stability.ai/docs/api-reference',
  },
  replicate: {
    label: 'Replicate',
    description: 'Run open-source models on Replicate cloud GPUs. Requires an API key.',
    docsUrl: 'https://replicate.com/docs',
  },
  huggingface: {
    label: 'HuggingFace Inference',
    description: 'HuggingFace serverless Inference API. Works without API key (rate-limited) or with a free token.',
    docsUrl: 'https://huggingface.co/docs/api-inference',
  },
};
