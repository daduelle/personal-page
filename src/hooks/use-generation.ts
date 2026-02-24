'use client';

import { useCallback, useRef, useState } from 'react';
import type { GenerationConfig } from '@/types';
import { useAppStore } from '@/store/app-store';
import { createProvider } from '@/lib/providers';
import { uid } from '@/lib/utils';
import { MANGA_STYLE_PROMPTS } from '@/lib/constants';

/**
 * Generation hook — delegates image creation to whatever provider
 * the user has configured (local SD, OpenAI, Stability, etc.).
 *
 * BYOB: the user owns the backend, we just call it.
 */
export function useGeneration() {
  const abortRef = useRef<AbortController | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const {
    providerConfig,
    providerStatus,
    generationConfig,
    generationStatus,
    setGenerationStatus,
    setIsGenerating,
    addJob,
    updateJob,
    updatePanelImage,
  } = useAppStore();

  const log = useCallback((level: string, message: string) => {
    setLogs((prev) => [...prev, `[${level.toUpperCase()}] ${message}`]);
  }, []);

  // ---- Build styled prompt from raw panel prompt ----
  const buildPromptWithStyle = useCallback(
    (prompt: string, negativePrompt?: string) => {
      const style = useAppStore.getState().generationConfig.style;
      const stylePrompts = MANGA_STYLE_PROMPTS[style];
      const fullPrompt = `${stylePrompts.prefix} ${prompt} ${stylePrompts.suffix}`;
      const fullNegative = [
        negativePrompt ?? useAppStore.getState().generationConfig.negativePrompt ?? '',
        stylePrompts.negative,
      ]
        .filter(Boolean)
        .join(', ');
      return { fullPrompt, fullNegative };
    },
    [],
  );

  // ---- Generate a single panel ----
  const generateForPanel = useCallback(
    async (
      panelId: string,
      prompt: string,
      negativePrompt?: string,
      configOverrides?: Partial<GenerationConfig>,
    ): Promise<string | null> => {
      const config: GenerationConfig = { ...generationConfig, ...configOverrides };
      const jobId = uid();

      const { fullPrompt, fullNegative } = buildPromptWithStyle(prompt, negativePrompt);

      addJob({
        id: jobId,
        panelId,
        prompt: fullPrompt,
        config,
        status: 'running',
        progress: 0,
      });

      try {
        const provider = createProvider(providerConfig);

        const result = await provider.generateImage(
          {
            prompt: fullPrompt,
            negativePrompt: fullNegative,
            width: config.width,
            height: config.height,
            guidanceScale: config.guidanceScale,
            steps: config.steps,
            seed: config.seed,
            signal: abortRef.current?.signal,
            loras: providerConfig.loras.length > 0 ? providerConfig.loras : undefined,
            model: providerConfig.selectedModel || undefined,
          },
          (status) => {
            setGenerationStatus({
              ...useAppStore.getState().generationStatus,
              currentStatus: status,
            });
          },
        );

        updateJob(jobId, {
          status: 'complete',
          progress: 100,
          result: {
            panelId,
            imageDataUrl: result.imageDataUrl,
            width: config.width,
            height: config.height,
            prompt: fullPrompt,
            seed: result.seed ?? config.seed ?? -1,
            timestamp: Date.now(),
          },
        });

        updatePanelImage(panelId, result.imageDataUrl);
        log('info', `Panel ${panelId} generated via ${providerConfig.type}`);
        return jobId;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          updateJob(jobId, { status: 'cancelled' });
          return null;
        }
        const errMsg = error instanceof Error ? error.message : String(error);
        updateJob(jobId, { status: 'error', error: errMsg });
        log('error', `Panel ${panelId} failed: ${errMsg}`);
        return null;
      }
    },
    [providerConfig, generationConfig, addJob, updateJob, updatePanelImage, setGenerationStatus, buildPromptWithStyle, log],
  );

  // ---- Generate all panels sequentially ----
  const generateAllPanels = useCallback(async () => {
    const panels = useAppStore.getState().panels;
    if (panels.length === 0) return;

    abortRef.current = new AbortController();
    setIsGenerating(true);
    setGenerationStatus({
      status: 'generating',
      currentPanel: 0,
      totalPanels: panels.length,
      currentStatus: `Starting generation via ${providerConfig.type}...`,
    });

    log('info', `Generating ${panels.length} panels via ${providerConfig.type}...`);

    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i];
      if (abortRef.current?.signal.aborted) break;

      setGenerationStatus({
        status: 'generating',
        currentPanel: i + 1,
        totalPanels: panels.length,
        currentStatus: `Generating panel ${i + 1} of ${panels.length}...`,
      });

      await generateForPanel(panel.id, panel.prompt);
    }

    setIsGenerating(false);
    setGenerationStatus({
      status: 'idle',
      currentPanel: panels.length,
      totalPanels: panels.length,
      currentStatus: 'Generation complete',
    });
    log('info', 'All panels processed');
  }, [generateForPanel, setIsGenerating, setGenerationStatus, providerConfig.type, log]);

  // ---- Cancel ongoing generation ----
  const cancelGeneration = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;

    const jobs = useAppStore.getState().jobs;
    for (const job of jobs) {
      if (job.status === 'queued' || job.status === 'running') {
        updateJob(job.id, { status: 'cancelled' });
      }
    }

    setIsGenerating(false);
    setGenerationStatus({
      status: 'idle',
      currentPanel: 0,
      totalPanels: 0,
      currentStatus: 'Cancelled',
    });
    log('info', 'Generation cancelled');
  }, [updateJob, setIsGenerating, setGenerationStatus, log]);

  return {
    generateForPanel,
    generateAllPanels,
    cancelGeneration,
    logs,
    generationStatus,
    isProviderConnected: providerStatus.connected,
  };
}
