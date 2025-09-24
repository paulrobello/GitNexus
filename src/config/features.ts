/**
 * Feature Flag Utilities
 * 
 * Centralized feature flag access using GitNexus configuration.
 * This replaces the old feature-flags.ts system.
 */

import { ConfigLoader } from './config-loader.ts';
import type { ValidatedGitNexusConfig } from './config-loader.ts';

let cachedConfig: ValidatedGitNexusConfig | null = null;

/**
 * Get the current configuration (with caching)
 */
async function getConfig(): Promise<ValidatedGitNexusConfig> {
  if (!cachedConfig) {
    cachedConfig = await ConfigLoader.getInstance().loadConfig();
  }
  return cachedConfig;
}

/**
 * Synchronous feature flag checks (uses cached config)
 * These functions maintain compatibility with the old feature-flags.ts API
 */

// KuzuDB Features
export function isKuzuDBEnabled(): boolean {
  return cachedConfig?.kuzu.enabled ?? true;
}

export function isKuzuDBPersistenceEnabled(): boolean {
  return cachedConfig?.kuzu.persistence ?? true;
}

export function isKuzuDBPerformanceMonitoringEnabled(): boolean {
  return cachedConfig?.features.enablePerformanceLogging ?? true;
}

export function isKuzuCopyEnabled(): boolean {
  return cachedConfig?.features.enableKuzuCopy ?? false;
}

// Processing Features
export function isParallelParsingEnabled(): boolean {
  return cachedConfig?.features.enableParallelParsing ?? true;
}

export function isParallelProcessingEnabled(): boolean {
  return cachedConfig?.processing.mode === 'parallel' && 
         (cachedConfig?.features.enableParallelProcessing ?? true);
}

export function isWebWorkersEnabled(): boolean {
  return cachedConfig?.features.enableWebWorkers ?? true;
}

export function isWorkerPoolEnabled(): boolean {
  return cachedConfig?.features.enableWorkerPool ?? true;
}

// Performance Features
export function isCachingEnabled(): boolean {
  return cachedConfig?.features.enableCaching ?? true;
}

export function isBatchProcessingEnabled(): boolean {
  return cachedConfig?.features.enableBatchProcessing ?? true;
}

export function isPerformanceMonitoringEnabled(): boolean {
  return cachedConfig?.features.enablePerformanceLogging ?? true;
}

// AI Features
export function isAdvancedRAGEnabled(): boolean {
  return cachedConfig?.features.enableAdvancedRAG ?? true;
}

export function isReActReasoningEnabled(): boolean {
  return cachedConfig?.features.enableReActReasoning ?? true;
}

export function isMultiLLMEnabled(): boolean {
  return cachedConfig?.features.enableMultiLLM ?? true;
}

// Debug Features
export function isDebugModeEnabled(): boolean {
  return cachedConfig?.features.enableDebugMode ?? false;
}

export function isQueryLoggingEnabled(): boolean {
  return cachedConfig?.features.enableQueryLogging ?? false;
}

/**
 * Get all feature flags as an object
 */
export function getFeatureFlags() {
  const config = cachedConfig;
  if (!config) {
    // Return defaults if config not loaded yet
    return {
      enableAdvancedRAG: true,
      enableReActReasoning: true,
      enableMultiLLM: true,
      enableWebWorkers: true,
      enableBatchProcessing: true,
      enableCaching: true,
      enableWorkerPool: true,
      enableParallelParsing: true,
      enableParallelProcessing: true,
      enableKuzuDB: true,
      enableKuzuDBPersistence: true,
      enableKuzuDBPerformanceMonitoring: true,
      enableKuzuCopy: false,
      enableDebugMode: false,
      enablePerformanceLogging: true,
      enableQueryLogging: false
    };
  }

  return {
    ...config.features,
    // Add KuzuDB flags from kuzu config section
    enableKuzuDB: config.kuzu.enabled,
    enableKuzuDBPersistence: config.kuzu.persistence,
    enableKuzuDBPerformanceMonitoring: config.features.enablePerformanceLogging
  };
}

/**
 * Initialize the feature system (loads config into cache)
 */
export async function initializeFeatures(): Promise<void> {
  try {
    cachedConfig = await getConfig();
    console.log('✅ Features initialized from GitNexus config');
  } catch (error) {
    console.warn('⚠️ Failed to initialize features, using defaults:', error);
  }
}

/**
 * Legacy compatibility - matches old FeatureFlagManager API
 */
export const featureFlagManager = {
  getFlag: (flagName: string): boolean => {
    const flags = getFeatureFlags();
    return (flags as any)[flagName] ?? false;
  },
  
  setFlag: (flagName: string, value: boolean): void => {
    console.warn('⚠️ setFlag is not supported in consolidated config system. Update gitnexus.config.ts instead.');
  },
  
  isKuzuDBEnabled,
  isDebugModeEnabled
};

// Auto-initialize when module is imported
initializeFeatures().catch(console.error);
