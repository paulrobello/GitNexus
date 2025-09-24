/**
 * GitNexus Configuration
 * 
 * Centralized configuration file for all GitNexus settings.
 * This replaces scattered .env variables and hardcoded values.
 * 
 * Environment variables can still override these values for deployment.
 */

export interface GitNexusConfig {
  // ========================================
  // PROCESSING CONFIGURATION
  // ========================================
  processing: {
    mode: 'parallel' | 'single';
    workers: {
      mode: 'auto' | 'manual';
      auto: {
        enabled: boolean;
        maxWorkers: number;
        memoryPerWorkerMB: number;
        cpuMultiplier: number;
      };
      manual: {
        count: number;
      };
    };
    parallel: {
      batchSize: number;
      workerTimeoutMs: number;
    };
    memory: {
      maxMB: number;
      cleanupThresholdMB: number;
      gcIntervalMs: number;
      maxFileSizeMB: number;
      maxFilesInMemory: number;
    };
    fileExtensions: string[];
    performanceMonitoring: boolean;
  };

  // ========================================
  // KUZU DB CONFIGURATION
  // ========================================
  kuzu: {
    enabled: boolean;
    persistence: boolean;
    dualWrite: boolean;
    fallbackToJson: boolean;
    performance: {
      enableCache: boolean;
      cacheSize: number;
      queryTimeout: number;
    };
  };

  // ========================================
  // AI & QUERY CONFIGURATION
  // ========================================
  ai: {
    cypher: {
      defaultLimit: number;
      maxLimit: number;
      timeoutMs: number;
      enableValidation: boolean;
      enableLimiting: boolean; // Enable/disable automatic LIMIT addition
      enableTruncation: boolean; // Enable/disable response truncation
    };
    llm: {
      defaultProvider: 'openai' | 'azure' | 'anthropic' | 'gemini';
      providers: {
        openai?: {
          apiKey?: string;
          model: string;
          maxTokens: number;
          temperature: number;
        };
        azure?: {
          apiKey?: string;
          endpoint?: string;
          deployment?: string;
          maxTokens: number;
          temperature: number;
        };
        anthropic?: {
          apiKey?: string;
          model: string;
          maxTokens: number;
          temperature: number;
        };
        gemini?: {
          apiKey?: string;
          model: string;
          maxTokens: number;
          temperature: number;
        };
      };
    };
  };

  // ========================================
  // IGNORE PATTERNS (CENTRALIZED!)
  // ========================================
  ignore: {
    enabled: boolean;
    patterns: string[];
    suffixes: string[];
    fileExtensions: string[];
    customPatterns: string[];
  };

  // ========================================
  // LOGGING & DEBUGGING
  // ========================================
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    enableMetrics: boolean;
    enablePerformance: boolean;
    maxEntries: number;
    monitoringIntervalMs: number;
  };

  // ========================================
  // GITHUB INTEGRATION
  // ========================================
  github: {
    token?: string;
    apiUrl: string;
    rateLimit: {
      maxRequests: number;
      windowMs: number;
    };
    retry: {
      maxRetries: number;
      backoffMs: number;
    };
  };

  // ========================================
  // FEATURE FLAGS
  // ========================================
  features: {
    // AI Features
    enableAdvancedRAG: boolean;
    enableReActReasoning: boolean;
    enableMultiLLM: boolean;
    
    // Performance Features
    enableWebWorkers: boolean;
    enableBatchProcessing: boolean;
    enableKuzuCopy: boolean;
    enableCaching: boolean;
    enableWorkerPool: boolean;
    enableParallelParsing: boolean;
    enableParallelProcessing: boolean;
    
    // Debug Features
    enableDebugMode: boolean;
    enablePerformanceLogging: boolean;
    enableQueryLogging: boolean;
  };

  // ========================================
  // ENVIRONMENT & DEPLOYMENT
  // ========================================
  environment: 'development' | 'staging' | 'production';
}

/**
 * Default GitNexus Configuration
 * 
 * Centralized configuration for the client-side application.
 * No environment variables needed - all settings are defined here.
 */
const config: GitNexusConfig = {

  // ========================================
  // PROCESSING CONFIGURATION
  // ========================================
  processing: {
    mode: 'parallel', // Use parallel processing by default
    workers: {
      mode: 'auto', // Use automatic hardware-based worker scaling
      auto: {
        enabled: true,
        maxWorkers: 20, // Maximum workers allowed (increased from user preference)
        memoryPerWorkerMB: 60, // Memory estimation per worker
        cpuMultiplier: 0.75 // Use 75% of CPU cores for safety
      },
      manual: {
        count: 4 // Fallback for manual mode
      }
    },
    parallel: {
      batchSize: 20, // Files processed per batch
      workerTimeoutMs: 60000 // 60 seconds timeout per worker
    },
    memory: {
      maxMB: 512,
      cleanupThresholdMB: 400,
      gcIntervalMs: 30000,
      maxFileSizeMB: 10,
      maxFilesInMemory: 1000
    },
    fileExtensions: [
      '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.h', '.hpp',
      '.cs', '.php', '.rb', '.go', '.rs', '.swift', '.kt', '.scala', '.dart',
      '.json', '.yaml', '.yml', '.xml', '.toml', '.ini', '.cfg', '.properties'
    ],
    performanceMonitoring: true
  },

  // ========================================
  // KUZU DB CONFIGURATION
  // ========================================
  kuzu: {
    enabled: true, // Enable KuzuDB dual-write mode
    persistence: true,
    dualWrite: true,
    fallbackToJson: true,
    performance: {
      enableCache: true,
      cacheSize: 1000,
      queryTimeout: 30000
    }
  },

  // ========================================
  // AI & QUERY CONFIGURATION
  // ========================================
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
      providers: {
        // API keys will be provided via UI settings
        // No hardcoded keys in configuration
        openai: {
          apiKey: '', // Set via UI
          model: 'gpt-4o-mini',
          maxTokens: 4000,
          temperature: 0.1
        }
      }
    }
  },

  // ========================================
  // IGNORE PATTERNS (CENTRALIZED!)
  // ========================================
  ignore: {
    enabled: true,
    patterns: [
      // Version Control
      '.git', '.svn', '.hg',
      // Package Managers & Dependencies
      'node_modules', 'bower_components', 'jspm_packages', 'vendor', 'deps',
      // Python Virtual Environments & Cache
      'venv', 'env', '.venv', '.env', 'envs', 'virtualenv', '__pycache__',
      '.pytest_cache', '.mypy_cache', '.tox',
      // Build & Distribution Directories
      'build', 'dist', 'out', 'target', 'bin', 'obj', '.gradle', '_build',
      // Static Assets and Public Directories
      'public', 'assets', 'static',
      // IDE & Editor Directories
      '.vs', '.vscode', '.idea', '.eclipse', '.settings',
      // Temporary & Log Directories
      'tmp', '.tmp', 'temp', 'logs', 'log',
      // Coverage & Testing
      'coverage', '.coverage', 'htmlcov', '.nyc_output',
      // OS & System
      '.DS_Store', 'Thumbs.db',
      // Documentation Build Output
      '_site', '.docusaurus',
      // Cache Directories
      '.cache', '.parcel-cache', '.next', '.nuxt'
    ],
    suffixes: ['.tmp', '~', '.bak', '.swp', '.swo'],
    fileExtensions: [
      // Compiled/Binary
      '.pyc', '.pyo', '.pyd', '.so', '.dll', '.exe', '.jar', '.war', '.ear',
      // Archives
      '.zip', '.tar', '.rar', '.7z', '.gz',
      // Media
      '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.ico', '.mp4', '.avi', '.mp3', '.wav',
      // Documents
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      // Fonts
      '.woff', '.woff2', '.ttf', '.eot', '.otf',
      // Minified/Generated
      '.min.js', '.min.css', '.map'
    ],
    customPatterns: []
  },

  // ========================================
  // LOGGING & DEBUGGING
  // ========================================
  logging: {
    level: 'info',
    enableMetrics: true,
    enablePerformance: true,
    maxEntries: 1000,
    monitoringIntervalMs: 30000
  },

  // ========================================
  // GITHUB INTEGRATION
  // ========================================
  github: {
    token: '', // Will be set via UI settings - no hardcoded tokens
    apiUrl: 'https://api.github.com',
    rateLimit: {
      maxRequests: 60, // GitHub default for unauthenticated requests
      windowMs: 60000 // 1 minute window
    },
    retry: {
      maxRetries: 3,
      backoffMs: 1000
    }
  },

  // ========================================
  // FEATURE FLAGS
  // ========================================
  features: {
    // AI Features
    enableAdvancedRAG: true,
    enableReActReasoning: true,
    enableMultiLLM: true,
    
    // Performance Features
    enableWebWorkers: true,
    enableBatchProcessing: true,
    enableKuzuCopy: true, // Enable COPY-based bulk loading
    enableCaching: true,
    enableWorkerPool: true,
    enableParallelParsing: true,
    enableParallelProcessing: true,
    
    // Debug Features
    enableDebugMode: false, // Can be enabled for development
    enablePerformanceLogging: true,
    enableQueryLogging: false
  },

  // ========================================
  // ENVIRONMENT & DEPLOYMENT
  // ========================================
  environment: 'development' // Can be changed for different deployments
};

export default config;
