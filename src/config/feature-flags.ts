/**
 * Feature Flags Configuration
 * Controls experimental features and integrations
 */

export interface FeatureFlags {
  // AI Features
  enableAdvancedRAG: boolean;
  enableReActReasoning: boolean;
  enableMultiLLM: boolean;
  
  // Performance Features
  enableWebWorkers: boolean;
  enableBatchProcessing: boolean;
  enableCaching: boolean;
  enableWorkerPool: boolean;
  enableParallelParsing: boolean;
  enableParallelProcessing: boolean;
  
  // KuzuDB Features
  enableKuzuDB: boolean;
  enableKuzuDBPersistence: boolean;
  enableKuzuDBPerformanceMonitoring: boolean;
  enableKuzuDBDirectWrites: boolean;
  
  // Debug Features
  enableDebugMode: boolean;
  enablePerformanceLogging: boolean;
  enableQueryLogging: boolean;
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  // AI Features
  enableAdvancedRAG: true,
  enableReActReasoning: true,
  enableMultiLLM: true,
  
  // Performance Features
  enableWebWorkers: true,
  enableBatchProcessing: true,
  enableCaching: true,
  enableWorkerPool: true,
  enableParallelParsing: true,
  enableParallelProcessing: true,
  
  // KuzuDB Features (disabled by default for safety)
  enableKuzuDB: false,
  enableKuzuDBPersistence: false,
  enableKuzuDBPerformanceMonitoring: false,
  enableKuzuDBDirectWrites: false,
  
  // Debug Features
  enableDebugMode: false,
  enablePerformanceLogging: false,
  enableQueryLogging: false
};

class FeatureFlagManager {
  private flags: FeatureFlags;
  private listeners: Set<(flags: FeatureFlags) => void> = new Set();

  constructor() {
    this.flags = this.loadFlags();
  }

  /**
   * Load feature flags from environment, localStorage, or use defaults
   */
  private loadFlags(): FeatureFlags {
    let flags = { ...DEFAULT_FEATURE_FLAGS };
    
    // First, override with environment variables
    // In Vite, environment variables are available via import.meta.env
    let parsingMode: string | undefined;
    let kuzuEnabled: string | undefined;
    
    try {
      // Try to access import.meta.env (available in Vite/ES modules)
      if (import.meta && import.meta.env) {
        parsingMode = import.meta.env.VITE_PARSING_MODE?.toLowerCase();
        kuzuEnabled = import.meta.env.VITE_KUZU_ENABLED?.toLowerCase();
      }
    } catch (e) {
      // Fallback to process.env (Node.js environments)
      if (typeof process !== 'undefined' && process.env) {
        parsingMode = process.env.PARSING_MODE?.toLowerCase();
        kuzuEnabled = process.env.KUZU_ENABLED?.toLowerCase();
      }
    }
    
    // Handle parsing mode
    if (parsingMode === 'single' || parsingMode === 'single-threaded') {
      flags.enableParallelParsing = false;
      console.log('🔄 Environment: Parallel parsing disabled via PARSING_MODE=single');
    } else if (parsingMode === 'parallel' || parsingMode === 'multi-threaded') {
      flags.enableParallelParsing = true;
      console.log('🚀 Environment: Parallel parsing enabled via PARSING_MODE=parallel');
    }
    
    // Handle KuzuDB settings
    console.log(`🔍 Debug: kuzuEnabled from env = "${kuzuEnabled}"`);
    console.log(`🔍 Debug: import.meta.env.VITE_KUZU_ENABLED = "${import.meta?.env?.VITE_KUZU_ENABLED}"`);
    
    if (kuzuEnabled === 'true' || kuzuEnabled === '1' || kuzuEnabled === 'yes') {
      flags.enableKuzuDB = true;
      flags.enableKuzuDBPersistence = true;
      flags.enableKuzuDBPerformanceMonitoring = true;
      console.log('🗃️ Environment: KuzuDB enabled via VITE_KUZU_ENABLED=true');
    } else if (kuzuEnabled === 'false' || kuzuEnabled === '0' || kuzuEnabled === 'no') {
      flags.enableKuzuDB = false;
      flags.enableKuzuDBPersistence = false;
      flags.enableKuzuDBPerformanceMonitoring = false;
      console.log('📄 Environment: KuzuDB disabled via VITE_KUZU_ENABLED=false');
    } else {
      console.log(`⚠️ Warning: KuzuDB env var not recognized: "${kuzuEnabled}" - using default: ${flags.enableKuzuDB}`);
    }
    
    // Handle KuzuDB Direct Writes settings
    let directWritesEnabled: string | undefined;
    try {
      if (import.meta && import.meta.env) {
        directWritesEnabled = import.meta.env.VITE_KUZU_DIRECT_WRITES?.toLowerCase();
      }
    } catch (e) {
      if (typeof process !== 'undefined' && process.env) {
        directWritesEnabled = process.env.KUZU_DIRECT_WRITES?.toLowerCase();
      }
    }
    
    console.log(`🔍 Debug: directWritesEnabled from env = "${directWritesEnabled}"`);
    
    if (directWritesEnabled === 'true' || directWritesEnabled === '1' || directWritesEnabled === 'yes') {
      flags.enableKuzuDBDirectWrites = true;
      console.log('⚡ Environment: KuzuDB direct writes enabled via VITE_KUZU_DIRECT_WRITES=true');
    } else if (directWritesEnabled === 'false' || directWritesEnabled === '0' || directWritesEnabled === 'no') {
      flags.enableKuzuDBDirectWrites = false;
      console.log('🔄 Environment: KuzuDB direct writes disabled via VITE_KUZU_DIRECT_WRITES=false');
    } else {
      console.log(`⚠️ Warning: KuzuDB direct writes env var not recognized: "${directWritesEnabled}" - using default: ${flags.enableKuzuDBDirectWrites}`);
    }
    
    // Then, try to load from localStorage (can override environment)
    // Only try localStorage if we're in a browser context (not in workers)
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('gitnexus_feature_flags');
        if (stored) {
          const parsed = JSON.parse(stored);
          flags = { ...flags, ...parsed };
        }
      }
    } catch (error) {
      console.warn('Failed to load feature flags from localStorage:', error);
    }
    
    return flags;
  }

  /**
   * Save feature flags to localStorage
   */
  private saveFlags(): void {
    try {
      localStorage.setItem('gitnexus_feature_flags', JSON.stringify(this.flags));
    } catch (error) {
      console.warn('Failed to save feature flags to localStorage:', error);
    }
  }

  /**
   * Get all feature flags
   */
  getFlags(): FeatureFlags {
    return { ...this.flags };
  }

  /**
   * Get a specific feature flag
   */
  getFlag<K extends keyof FeatureFlags>(key: K): FeatureFlags[K] {
    return this.flags[key];
  }

  /**
   * Set a feature flag
   */
  setFlag<K extends keyof FeatureFlags>(key: K, value: FeatureFlags[K]): void {
    this.flags[key] = value;
    this.saveFlags();
    this.notifyListeners();
  }

  /**
   * Set multiple feature flags
   */
  setFlags(updates: Partial<FeatureFlags>): void {
    this.flags = { ...this.flags, ...updates };
    this.saveFlags();
    this.notifyListeners();
  }

  /**
   * Reset all feature flags to defaults
   */
  resetFlags(): void {
    this.flags = { ...DEFAULT_FEATURE_FLAGS };
    this.saveFlags();
    this.notifyListeners();
  }

  /**
   * Enable KuzuDB integration
   */
  enableKuzuDB(): void {
    this.setFlags({
      enableKuzuDB: true,
      enableKuzuDBPersistence: true,
      enableKuzuDBPerformanceMonitoring: true
    });
  }

  /**
   * Disable KuzuDB integration
   */
  disableKuzuDB(): void {
    this.setFlags({
      enableKuzuDB: false,
      enableKuzuDBPersistence: false,
      enableKuzuDBPerformanceMonitoring: false
    });
  }

  /**
   * Enable worker pool and parallel processing
   */
  enableWorkerPool(): void {
    this.setFlags({
      enableWorkerPool: true,
      enableParallelParsing: true,
      enableParallelProcessing: true
    });
  }

  /**
   * Disable worker pool and parallel processing
   */
  disableWorkerPool(): void {
    this.setFlags({
      enableWorkerPool: false,
      enableParallelParsing: false,
      enableParallelProcessing: false
    });
  }

  /**
   * Enable debug mode
   */
  enableDebugMode(): void {
    this.setFlags({
      enableDebugMode: true,
      enablePerformanceLogging: true,
      enableQueryLogging: true
    });
  }

  /**
   * Disable debug mode
   */
  disableDebugMode(): void {
    this.setFlags({
      enableDebugMode: false,
      enablePerformanceLogging: false,
      enableQueryLogging: false
    });
  }

  /**
   * Add a listener for flag changes
   */
  addListener(listener: (flags: FeatureFlags) => void): void {
    this.listeners.add(listener);
  }

  /**
   * Remove a listener
   */
  removeListener(listener: (flags: FeatureFlags) => void): void {
    this.listeners.delete(listener);
  }

  /**
   * Notify all listeners of flag changes
   */
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.getFlags());
      } catch (error) {
        console.error('Feature flag listener error:', error);
      }
    }
  }

  /**
   * Check if KuzuDB is fully enabled
   */
  isKuzuDBEnabled(): boolean {
    return this.flags.enableKuzuDB && this.flags.enableKuzuDBPersistence;
  }

  /**
   * Check if debug mode is enabled
   */
  isDebugModeEnabled(): boolean {
    return this.flags.enableDebugMode;
  }

  /**
   * Check if performance monitoring is enabled
   */
  isPerformanceMonitoringEnabled(): boolean {
    return this.flags.enableKuzuDBPerformanceMonitoring || this.flags.enablePerformanceLogging;
  }
}

// Export singleton instance
export const featureFlags = new FeatureFlagManager();

// Export convenience functions
export const getFeatureFlag = <K extends keyof FeatureFlags>(key: K): FeatureFlags[K] => 
  featureFlags.getFlag(key);

export const getFeatureFlags = (): FeatureFlags => featureFlags.getFlags();

export const setFeatureFlag = <K extends keyof FeatureFlags>(key: K, value: FeatureFlags[K]): void => 
  featureFlags.setFlag(key, value);

export const isKuzuDBEnabled = (): boolean => featureFlags.isKuzuDBEnabled();
export const isKuzuDBPersistenceEnabled = (): boolean => featureFlags.getFlag('enableKuzuDBPersistence');
export const isKuzuDBDirectWritesEnabled = (): boolean => featureFlags.getFlag('enableKuzuDBDirectWrites');
export const isDebugModeEnabled = (): boolean => featureFlags.isDebugModeEnabled();
export const isPerformanceMonitoringEnabled = (): boolean => featureFlags.isPerformanceMonitoringEnabled();
export const isWorkerPoolEnabled = (): boolean => featureFlags.getFlag('enableWorkerPool');
export const isParallelParsingEnabled = (): boolean => featureFlags.getFlag('enableParallelParsing');
export const isParallelProcessingEnabled = (): boolean => featureFlags.getFlag('enableParallelProcessing');
