'use client';

import { useState, useCallback, useEffect } from 'react';
import { useAppStore } from '@/store/app-store';
import { createProvider, PROVIDER_META } from '@/lib/providers';
import { setStoredToken, getStoredToken } from '@/lib/providers/huggingface';
import type { ProviderType, LoraConfig } from '@/types';
import { cn } from '@/lib/utils';

const PROVIDER_TYPES: ProviderType[] = [
  'local-sd',
  'openai',
  'google',
  'stability',
  'replicate',
  'huggingface',
];

/**
 * Provider configuration panel — BYOB (Bring Your Own Backend).
 *
 * Lets the user select a provider, enter connection details,
 * test the connection, and configure provider-specific settings
 * (models, LoRAs, API keys).
 */
export function ProviderConfig() {
  const {
    providerConfig,
    providerStatus,
    setProviderConfig,
    setProviderStatus,
  } = useAppStore();

  const [isTestingConnection, setIsTestingConnection] = useState(false);

  // Sync HuggingFace token from localStorage on mount
  useEffect(() => {
    if (providerConfig.type === 'huggingface' && !providerConfig.apiKey) {
      const stored = getStoredToken();
      if (stored) setProviderConfig({ apiKey: stored });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Test Connection ----
  const testConnection = useCallback(async () => {
    setIsTestingConnection(true);
    setProviderStatus({ checking: true, error: undefined });

    try {
      const provider = createProvider(providerConfig);
      const result = await provider.checkConnection();

      if (result.ok) {
        // Fetch models and LoRAs if supported
        let availableModels: string[] = [];
        let availableLoras: import('@/types').LoraInfo[] = [];

        if (provider.listModels) {
          try {
            availableModels = await provider.listModels();
          } catch { /* non-fatal */ }
        }

        if (provider.listLoras) {
          try {
            availableLoras = await provider.listLoras();
          } catch { /* non-fatal */ }
        }

        setProviderStatus({
          connected: true,
          checking: false,
          error: undefined,
          availableModels,
          availableLoras,
        });
      } else {
        setProviderStatus({
          connected: false,
          checking: false,
          error: result.error,
        });
      }
    } catch (err) {
      setProviderStatus({
        connected: false,
        checking: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsTestingConnection(false);
    }
  }, [providerConfig, setProviderStatus]);

  // ---- Provider switch handler ----
  const switchProvider = useCallback(
    (type: ProviderType) => {
      const defaults: Record<ProviderType, { baseUrl: string }> = {
        'local-sd': { baseUrl: 'http://127.0.0.1:7860' },
        openai: { baseUrl: 'https://api.openai.com' },
        google: { baseUrl: 'https://generativelanguage.googleapis.com' },
        stability: { baseUrl: 'https://api.stability.ai' },
        replicate: { baseUrl: 'https://api.replicate.com' },
        huggingface: { baseUrl: 'https://api-inference.huggingface.co' },
      };
      setProviderConfig({
        type,
        baseUrl: defaults[type].baseUrl,
        apiKey: type === 'huggingface' ? getStoredToken() : '',
        selectedModel: '',
        loras: [],
      });
      setProviderStatus({
        connected: false,
        checking: false,
        error: undefined,
        availableModels: [],
        availableLoras: [],
      });
    },
    [setProviderConfig, setProviderStatus],
  );

  // ---- LoRA management ----
  const addLora = useCallback(
    (name: string) => {
      if (providerConfig.loras.some((l) => l.name === name)) return;
      setProviderConfig({
        loras: [...providerConfig.loras, { name, weight: 0.7 }],
      });
    },
    [providerConfig.loras, setProviderConfig],
  );

  const removeLora = useCallback(
    (name: string) => {
      setProviderConfig({
        loras: providerConfig.loras.filter((l) => l.name !== name),
      });
    },
    [providerConfig.loras, setProviderConfig],
  );

  const updateLoraWeight = useCallback(
    (name: string, weight: number) => {
      setProviderConfig({
        loras: providerConfig.loras.map((l) =>
          l.name === name ? { ...l, weight } : l,
        ),
      });
    },
    [providerConfig.loras, setProviderConfig],
  );

  const isLocalSD = providerConfig.type === 'local-sd';
  const needsApiKey = !isLocalSD;
  const meta = PROVIDER_META[providerConfig.type];

  return (
    <div className="rounded-sm border-2 border-manga-black bg-white p-4">
      <h3 className="mb-1 font-manga text-base tracking-wide text-manga-black">
        Image Generation Backend
      </h3>
      <p className="mb-4 text-[10px] text-manga-gray-400">
        BYOB — Connect your own image generation server or API.
      </p>

      {/* ---- Provider Type Selector ---- */}
      <div className="mb-4">
        <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-manga-gray-500">
          Provider
        </label>
        <div className="flex flex-wrap gap-1.5">
          {PROVIDER_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => switchProvider(type)}
              className={cn(
                'rounded-sm border-2 px-3 py-1.5',
                'text-[10px] font-bold uppercase tracking-wider',
                'transition-all',
                providerConfig.type === type
                  ? 'border-manga-black bg-manga-black text-white'
                  : 'border-manga-gray-300 text-manga-gray-600 hover:border-manga-black',
              )}
            >
              {PROVIDER_META[type].label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] text-manga-gray-400">
          {meta.description}
        </p>
      </div>

      {/* ---- Connection Settings ---- */}
      <div className="space-y-3">
        {/* Base URL (local SD only) */}
        {isLocalSD && (
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-manga-gray-500">
              Server URL
            </label>
            <input
              type="text"
              value={providerConfig.baseUrl}
              onChange={(e) => setProviderConfig({ baseUrl: e.target.value })}
              placeholder="http://127.0.0.1:7860"
              className={cn(
                'w-full rounded-sm border-2 border-manga-black px-3 py-2',
                'text-sm font-medium font-mono placeholder:text-manga-gray-300',
                'focus:outline-none focus:ring-2 focus:ring-manga-blue',
              )}
            />
            <p className="mt-1 text-[9px] text-manga-gray-400">
              pip install manga-readme &amp;&amp; manga-readme serve -- or start A1111/Forge with --api
            </p>
          </div>
        )}

        {/* API Key (cloud providers) */}
        {needsApiKey && (
          <ApiKeyInput
            value={providerConfig.apiKey}
            onChange={(val) => {
              setProviderConfig({ apiKey: val });
              if (providerConfig.type === 'huggingface') setStoredToken(val);
            }}
            providerType={providerConfig.type}
          />
        )}

        {/* Test Connection Button */}
        <div className="flex items-center gap-3">
          <button
            onClick={testConnection}
            disabled={isTestingConnection}
            className={cn(
              'rounded-sm border-2 border-manga-black px-4 py-2',
              'text-xs font-bold uppercase tracking-wider',
              'transition-all',
              isTestingConnection
                ? 'bg-manga-gray-200 text-manga-gray-400 cursor-wait'
                : 'bg-manga-accent text-white shadow-[2px_2px_0_0_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px]',
            )}
          >
            {isTestingConnection ? 'Testing...' : 'Test Connection'}
          </button>

          {/* Connection Status */}
          <ConnectionBadge
            connected={providerStatus.connected}
            checking={providerStatus.checking}
            error={providerStatus.error}
          />
        </div>
      </div>

      {/* ---- Local SD: Model & LoRA Selection ---- */}
      {isLocalSD && providerStatus.connected && (
        <div className="mt-4 space-y-3 border-t border-manga-gray-200 pt-4">
          {/* Model Selector */}
          {providerStatus.availableModels.length > 0 && (
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-manga-gray-500">
                Checkpoint
              </label>
              <select
                value={providerConfig.selectedModel}
                onChange={(e) => setProviderConfig({ selectedModel: e.target.value })}
                className={cn(
                  'w-full rounded-sm border-2 border-manga-black bg-white px-3 py-2',
                  'text-sm font-medium text-manga-black',
                  'focus:outline-none focus:ring-2 focus:ring-manga-blue',
                )}
              >
                <option value="">Server default</option>
                {providerStatus.availableModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <p className="mt-0.5 text-[9px] text-manga-gray-400">
                Pick a model from your server. manga-readme ships with DreamShaper 8, SDXL, Animagine XL, and more.
              </p>
            </div>
          )}

          {/* LoRA Section */}
          {providerStatus.availableLoras.length > 0 && (
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-manga-gray-500">
                LoRAs
              </label>
              <p className="mb-2 text-[9px] text-manga-gray-400">
                LoRAs are injected into the prompt as &lt;lora:name:weight&gt; tags. Adjust the weight to control influence.
              </p>

              {/* Active LoRAs */}
              {providerConfig.loras.length > 0 && (
                <div className="mb-2 space-y-1.5">
                  {providerConfig.loras.map((lora) => (
                    <LoraRow
                      key={lora.name}
                      lora={lora}
                      onRemove={() => removeLora(lora.name)}
                      onWeightChange={(w) => updateLoraWeight(lora.name, w)}
                    />
                  ))}
                </div>
              )}

              {/* Add LoRA */}
              <div className="flex flex-wrap gap-1">
                {providerStatus.availableLoras
                  .filter((l) => !providerConfig.loras.some((a) => a.name === l.name))
                  .slice(0, 20)
                  .map((lora) => (
                    <button
                      key={lora.name}
                      onClick={() => addLora(lora.name)}
                      className={cn(
                        'rounded-sm border border-manga-gray-200 px-1.5 py-0.5',
                        'text-[10px] text-manga-gray-500',
                        'transition-colors hover:border-manga-black hover:text-manga-black',
                      )}
                      title={lora.alias ?? lora.name}
                    >
                      + {lora.alias ?? lora.name}
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- Cloud Provider: Model Selector ---- */}
      {!isLocalSD && providerStatus.connected && providerStatus.availableModels.length > 0 && (
        <div className="mt-4 border-t border-manga-gray-200 pt-4">
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-manga-gray-500">
            Model
          </label>
          <select
            value={providerConfig.selectedModel}
            onChange={(e) => setProviderConfig({ selectedModel: e.target.value })}
            className={cn(
              'w-full rounded-sm border-2 border-manga-black bg-white px-3 py-2',
              'text-sm font-medium text-manga-black',
              'focus:outline-none focus:ring-2 focus:ring-manga-blue',
            )}
          >
            <option value="">Default</option>
            {providerStatus.availableModels.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      )}

      {/* ---- Docs link ---- */}
      <div className="mt-4 text-right">
        <a
          href={meta.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] font-bold text-manga-blue hover:underline"
        >
          View API Docs
        </a>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Sub-components                                                     */
/* ================================================================== */

function ApiKeyInput({
  value,
  onChange,
  providerType,
}: {
  value: string;
  onChange: (val: string) => void;
  providerType: ProviderType;
}) {
  const [show, setShow] = useState(false);

  const placeholder: Record<string, string> = {
    openai: 'sk-...',
    google: 'AIza...',
    stability: 'sk-...',
    replicate: 'r8_...',
    huggingface: 'hf_... (optional for free tier)',
  };

  return (
    <div>
      <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-manga-gray-500">
        API Key
      </label>
      <div className="flex gap-2">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder[providerType] ?? 'Enter API key'}
          className={cn(
            'flex-1 rounded-sm border-2 border-manga-black px-3 py-2',
            'text-sm font-mono placeholder:text-manga-gray-300',
            'focus:outline-none focus:ring-2 focus:ring-manga-blue',
          )}
        />
        <button
          onClick={() => setShow(!show)}
          className="rounded-sm border-2 border-manga-gray-300 px-2 py-1 text-[10px] font-bold text-manga-gray-500 hover:border-manga-black"
          type="button"
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      {providerType === 'huggingface' && (
        <p className="mt-1 text-[9px] text-manga-gray-400">
          Token is optional. Providing one gives higher rate limits.
        </p>
      )}
      {providerType === 'google' && (
        <p className="mt-1 text-[9px] text-manga-gray-400">
          Use a Gemini API key from Google AI Studio. Nano Banana image models are supported.
        </p>
      )}
    </div>
  );
}

function ConnectionBadge({
  connected,
  checking,
  error,
}: {
  connected: boolean;
  checking: boolean;
  error?: string;
}) {
  if (checking) {
    return (
      <span className="flex items-center gap-1.5 text-[10px] text-manga-gray-500">
        <span className="h-2 w-2 animate-pulse rounded-full bg-yellow-400" />
        Checking...
      </span>
    );
  }
  if (connected) {
    return (
      <span className="flex items-center gap-1.5 text-[10px] text-green-700">
        <span className="h-2 w-2 rounded-full bg-green-500" />
        Connected
      </span>
    );
  }
  if (error) {
    return (
      <span className="flex items-center gap-1.5 text-[10px] text-red-600" title={error}>
        <span className="h-2 w-2 rounded-full bg-red-500" />
        {error.length > 50 ? `${error.slice(0, 50)}...` : error}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-[10px] text-manga-gray-400">
      <span className="h-2 w-2 rounded-full bg-manga-gray-300" />
      Not connected
    </span>
  );
}

function LoraRow({
  lora,
  onRemove,
  onWeightChange,
}: {
  lora: LoraConfig;
  onRemove: () => void;
  onWeightChange: (w: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-sm border border-manga-gray-200 bg-manga-gray-100/50 px-2 py-1.5">
      <span className="flex-1 truncate text-[11px] font-medium text-manga-black">
        {lora.name}
      </span>
      <input
        type="range"
        min={0}
        max={1.5}
        step={0.05}
        value={lora.weight}
        onChange={(e) => onWeightChange(parseFloat(e.target.value))}
        className="w-20 accent-manga-accent"
      />
      <span className="w-8 text-right text-[10px] font-mono text-manga-gray-500">
        {lora.weight.toFixed(2)}
      </span>
      <button
        onClick={onRemove}
        className="text-[10px] text-manga-gray-400 hover:text-red-500"
        title="Remove"
      >
        x
      </button>
    </div>
  );
}
