/**
 * Kernel access hooks.
 *
 * Components never import the kernel singleton directly; they read services
 * from it, which is what allows a plugin to swap `renderer`/`theme`/`llm` and
 * have every component pick up the change on the next render.
 */

import * as React from 'react';
import { useApp } from '@/state/store.js';
import type { ServiceRegistry } from '@/core/plugin/registry.js';
import type { LLMService } from '@/core/llm/types.js';
import type { ImageService } from '@/core/image/types.js';
import type { AgentLoop, RendererService, ThemeService } from '@/core/agent/types.js';
import { SERVICE } from '@/core/plugin/kernel-types.js';

const KernelContext = React.createContext<ServiceRegistry | null>(null);

export function KernelProvider({ kernel, children }: { kernel: ServiceRegistry; children: React.ReactNode }) {
  return <KernelContext.Provider value={kernel}>{children}</KernelContext.Provider>;
}

export function useKernel(): ServiceRegistry {
  return useApp.getState().kernel ?? (null as unknown as ServiceRegistry);
}

/**
 * Subscribe to a service and re-render when it is (re)provided.
 * Returns `undefined` while the providing plugin is inactive.
 */
export function useKernelService<T>(key: string): T | undefined {
  const kernel = useApp((s) => s.kernel);
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    if (!kernel) return;
    return kernel.observe(key, () => force());
  }, [kernel, key]);
  return kernel?.get<T>(key);
}

export const useLLM = () => useKernelService<LLMService>(SERVICE.LLM);
export const useImage = () => useKernelService<ImageService>(SERVICE.IMAGE);
export const useAgentLoop = () => useKernelService<AgentLoop>(SERVICE.AGENT_LOOP);
export const useRenderer = () => useKernelService<RendererService>(SERVICE.RENDERER);
export const useThemeService = () => useKernelService<ThemeService>(SERVICE.THEME);
