/**
 * Configuration Loader
 * 
 * Loads and validates configuration from the root gitnexus.config.ts file
 * with Zod schema validation and type safety.
 */

import { z } from 'zod';

// Zod schemas for validation

const ProcessingConfigSchema = z.object({
  mode: z.enum(['parallel', 'single']),
  workers: z.object({
    mode: z.enum(['auto', 'manual']),
    auto: z.object({
      enabled: z.boolean(),
      maxWorkers: z.number().min(1).max(32),
      memoryPerWorkerMB: z.number().min(20).max(200),
      cpuMultiplier: z.number().min(0.1).max(2.0)
    }),
    manual: z.object({
      count: z.number().min(1).max(32)
    })
  }),
  parallel: z.object({
    batchSize: z.number().min(1).max(100),
    workerTimeoutMs: z.number().min(10000).max(300000)
  }),
  memory: z.object({
    maxMB: z.number().min(100).max(4096),
    cleanupThresholdMB: z.number().min(50).max(2048),
    gcIntervalMs: z.number().min(5000).max(60000),
    maxFileSizeMB: z.number().min(1).max(100),
    maxFilesInMemory: z.number().min(100).max(10000)
  }),
  fileExtensions: z.array(z.string()),
  performanceMonitoring: z.boolean()
});

const KuzuConfigSchema = z.object({
  enabled: z.boolean(),
  persistence: z.boolean(),
  dualWrite: z.boolean(),
  fallbackToJson: z.boolean(),
  performance: z.object({
    enableCache: z.boolean(),
    cacheSize: z.number().min(100).max(10000),
    queryTimeout: z.number().min(1000).max(60000)
  })
});

const AIConfigSchema = z.object({
  cypher: z.object({
    defaultLimit: z.number().min(1).max(1000),
    maxLimit: z.number().min(10).max(1000),
    timeoutMs: z.number().min(1000).max(60000),
    enableValidation: z.boolean(),
    enableLimiting: z.boolean(),
    enableTruncation: z.boolean()
  }),
  llm: z.object({
    defaultProvider: z.enum(['openai', 'azure', 'anthropic', 'gemini']),
    providers: z.object({
      openai: z.object({
        apiKey: z.string().optional(),
        model: z.string(),
        maxTokens: z.number().min(100).max(10000),
        temperature: z.number().min(0).max(2)
      }).optional(),
      azure: z.object({
        apiKey: z.string().optional(),
        endpoint: z.string().optional(),
        deployment: z.string().optional(),
        maxTokens: z.number().min(100).max(10000),
        temperature: z.number().min(0).max(2)
      }).optional(),
      anthropic: z.object({
        apiKey: z.string().optional(),
        model: z.string(),
        maxTokens: z.number().min(100).max(10000),
        temperature: z.number().min(0).max(2)
      }).optional(),
      gemini: z.object({
        apiKey: z.string().optional(),
        model: z.string(),
        maxTokens: z.number().min(100).max(10000),
        temperature: z.number().min(0).max(2)
      }).optional()
    })
  })
});

const IgnoreConfigSchema = z.object({
  enabled: z.boolean(),
  patterns: z.array(z.string()),
  suffixes: z.array(z.string()),
  fileExtensions: z.array(z.string()),
  customPatterns: z.array(z.string())
});

const LoggingConfigSchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']),
  enableMetrics: z.boolean(),
  enablePerformance: z.boolean(),
  maxEntries: z.number().min(100).max(10000),
  monitoringIntervalMs: z.number().min(5000).max(60000)
});

const GitHubConfigSchema = z.object({
  token: z.string().optional(),
  apiUrl: z.string().url(),
  rateLimit: z.object({
    maxRequests: z.number().min(1).max(5000),
    windowMs: z.number().min(1000).max(3600000)
  }),
  retry: z.object({
    maxRetries: z.number().min(0).max(10),
    backoffMs: z.number().min(100).max(10000)
  })
});

const FeaturesConfigSchema = z.object({
  // AI Features
  enableAdvancedRAG: z.boolean(),
  enableReActReasoning: z.boolean(),
  enableMultiLLM: z.boolean(),
  
  // Performance Features
  enableWebWorkers: z.boolean(),
  enableBatchProcessing: z.boolean(),
  enableKuzuCopy: z.boolean(),
  enableCaching: z.boolean(),
  enableWorkerPool: z.boolean(),
  enableParallelParsing: z.boolean(),
  enableParallelProcessing: z.boolean(),
  
  // Debug Features
  enableDebugMode: z.boolean(),
  enablePerformanceLogging: z.boolean(),
  enableQueryLogging: z.boolean()
});

const GitNexusConfigSchema = z.object({
  processing: ProcessingConfigSchema,
  kuzu: KuzuConfigSchema,
  ai: AIConfigSchema,
  ignore: IgnoreConfigSchema,
  logging: LoggingConfigSchema,
  github: GitHubConfigSchema,
  features: FeaturesConfigSchema,
  environment: z.enum(['development', 'staging', 'production'])
});

export type ValidatedGitNexusConfig = z.infer<typeof GitNexusConfigSchema>;

/**
 * Configuration Loader Service
 */
export class ConfigLoader {
  private static instance: ConfigLoader;
  private config: ValidatedGitNexusConfig | null = null;
  private validationErrors: string[] = [];

  private constructor() {}

  public static getInstance(): ConfigLoader {
    if (!ConfigLoader.instance) {
      ConfigLoader.instance = new ConfigLoader();
    }
    return ConfigLoader.instance;
  }

  /**
   * Load and validate configuration from gitnexus.config.ts
   */
  public async loadConfig(): Promise<ValidatedGitNexusConfig> {
    if (this.config) {
      return this.config;
    }

    try {
      // Import the config file
      const configModule = await import('../../gitnexus.config.ts');
      const rawConfig = configModule.default;

      // Validate with Zod
      const result = GitNexusConfigSchema.safeParse(rawConfig);
      
      if (!result.success) {
        this.validationErrors = result.error.errors.map(e => 
          `${e.path.join('.')}: ${e.message}`
        );
        console.error('❌ Configuration validation errors:', this.validationErrors);
        
        // Return a minimal valid config as fallback
        this.config = this.getMinimalConfig();
      } else {
        this.config = result.data;
        console.log('✅ Configuration loaded and validated successfully');
      }

      return this.config;
    } catch (error) {
      console.error('❌ Failed to load gitnexus.config.ts:', error);
      this.config = this.getMinimalConfig();
      return this.config;
    }
  }

  /**
   * Get minimal fallback configuration
   */
  private getMinimalConfig(): ValidatedGitNexusConfig {
    return {
      processing: {
        mode: 'parallel',
        workers: {
          mode: 'auto',
          auto: {
            enabled: true,
            maxWorkers: 16,
            memoryPerWorkerMB: 60,
            cpuMultiplier: 0.75
          },
          manual: {
            count: 4
          }
        },
        parallel: {
          batchSize: 20,
          workerTimeoutMs: 60000
        },
        memory: {
          maxMB: 512,
          cleanupThresholdMB: 400,
          gcIntervalMs: 30000,
          maxFileSizeMB: 10,
          maxFilesInMemory: 1000
        },
        fileExtensions: ['.js', '.ts', '.jsx', '.tsx', '.py'],
        performanceMonitoring: true
      },
      kuzu: {
        enabled: true,
        persistence: true,
        dualWrite: true,
        fallbackToJson: true,
        performance: {
          enableCache: true,
          cacheSize: 1000,
          queryTimeout: 30000
        }
      },
      ai: {
        cypher: {
          defaultLimit: 20,
          maxLimit: 100,
          timeoutMs: 30000,
          enableValidation: true,
          enableLimiting: true,
          enableTruncation: true
        },
        llm: {
          defaultProvider: 'openai',
          providers: {}
        }
      },
      ignore: {
        enabled: true,
        patterns: ['node_modules', '.git', 'build', 'dist'],
        suffixes: ['.tmp', '~'],
        fileExtensions: ['.pyc', '.zip', '.jpg'],
        customPatterns: []
      },
      logging: {
        level: 'info',
        enableMetrics: true,
        enablePerformance: true,
        maxEntries: 1000,
        monitoringIntervalMs: 30000
      },
      github: {
        token: '',
        apiUrl: 'https://api.github.com',
        rateLimit: {
          maxRequests: 60,
          windowMs: 60000
        },
        retry: {
          maxRetries: 3,
          backoffMs: 1000
        }
      },
      features: {
        // AI Features
        enableAdvancedRAG: true,
        enableReActReasoning: true,
        enableMultiLLM: true,
        
        // Performance Features
        enableWebWorkers: true,
        enableBatchProcessing: true,
        enableKuzuCopy: false,
        enableCaching: true,
        enableWorkerPool: true,
        enableParallelParsing: true,
        enableParallelProcessing: true,
        
        // Debug Features
        enableDebugMode: false,
        enablePerformanceLogging: true,
        enableQueryLogging: false
      },
      environment: 'development'
    };
  }

  /**
   * Get current configuration
   */
  public getConfig(): ValidatedGitNexusConfig | null {
    return this.config;
  }

  /**
   * Get validation errors
   */
  public getValidationErrors(): string[] {
    return [...this.validationErrors];
  }

  /**
   * Reload configuration (useful for development)
   */
  public async reloadConfig(): Promise<ValidatedGitNexusConfig> {
    this.config = null;
    this.validationErrors = [];
    return this.loadConfig();
  }
}

// Export singleton instance
export const configLoader = ConfigLoader.getInstance();
