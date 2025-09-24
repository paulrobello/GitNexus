/**
 * Web Worker Pool Manager for parallel processing in browsers
 * Manages a pool of Web Workers to process tasks concurrently
 */

interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface PerformanceWithMemory extends Performance {
  memory?: PerformanceMemory;
}

interface WindowWithGC extends Window {
  gc?: () => void;
}

export interface WorkerTask<TInput = unknown, TOutput = unknown> {
  id: string;
  input: TInput;
  resolve: (result: TOutput) => void;
  reject: (error: Error) => void;
}

export interface WorkerPoolOptions {
  maxWorkers?: number;
  workerScript?: string;
  timeout?: number;
  name?: string;
}

export interface WorkerPoolStats {
  totalWorkers: number;
  availableWorkers: number;
  activeTasks: number;
  queuedTasks: number;
  maxWorkers: number;
  memoryUsage?: number;
}

export class WebWorkerPool {
  private workers: Worker[] = [];
  private availableWorkers: Worker[] = [];
  private taskQueue: WorkerTask<unknown, unknown>[] = [];
  private activeTasks: Map<string, WorkerTask<unknown, unknown>> = new Map();
  private maxWorkers: number;
  private workerScript: string;
  private timeout: number;
  private isShuttingDown: boolean = false;
  private name: string;
  private eventListeners: Map<string, Set<(data: unknown) => void>> = new Map();

  constructor(options: WorkerPoolOptions = {}) {
    // Use provided maxWorkers or calculate a reasonable default
    this.maxWorkers = options.maxWorkers ?? Math.max(2, navigator.hardwareConcurrency || 4);
    this.workerScript = options.workerScript || '/workers/generic-worker.js';
    this.timeout = options.timeout || 30000; // 30 seconds
    this.name = options.name || 'WebWorkerPool';
    
    // Debug: Log actual worker configuration
    console.log(`🔧 WebWorkerPool "${this.name}" constructor:`);
    console.log(`   Requested maxWorkers: ${options.maxWorkers}`);
    console.log(`   Actual maxWorkers: ${this.maxWorkers}`);
    console.log(`   navigator.hardwareConcurrency: ${navigator.hardwareConcurrency}`);
  }

  /**
   * Get the maximum number of workers configured
   */
  get maxWorkersCount(): number {
    return this.maxWorkers;
  }

  /**
   * Execute a task using available worker
   */
  async execute<TInput, TOutput>(input: TInput): Promise<TOutput> {
    if (this.isShuttingDown) {
      throw new Error('Worker pool is shutting down');
    }

    return new Promise<TOutput>((resolve, reject) => {
      const task: WorkerTask<TInput, TOutput> = {
        id: this.generateTaskId(),
        input,
        resolve,
        reject
      };

      this.taskQueue.push(task as WorkerTask<unknown, unknown>);
      this.processQueue();
    });
  }

  /**
   * Execute multiple tasks in parallel
   */
  async executeAll<TInput, TOutput>(inputs: TInput[]): Promise<TOutput[]> {
    const promises = inputs.map(input => this.execute<TInput, TOutput>(input));
    return Promise.all(promises);
  }

  /**
   * Execute tasks with concurrency limit
   */
  async executeBatch<TInput, TOutput>(
    inputs: TInput[], 
    batchSize: number = this.maxWorkers
  ): Promise<TOutput[]> {
    const results: TOutput[] = [];    
    for (let i = 0; i < inputs.length; i += batchSize) {
      const batch = inputs.slice(i, i + batchSize);
      const batchResults = await this.executeAll<TInput, TOutput>(batch);
      results.push(...batchResults);
    }
    return results;
  }

  /**
   * Execute tasks with progress callback
   */
  async executeWithProgress<TInput, TOutput>(
    inputs: TInput[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<TOutput[]> {
    // Just use executeAll - it already handles parallel processing properly
    const results = await this.executeAll<TInput, TOutput>(inputs);
    
    // Report completion
    if (onProgress) {
      onProgress(inputs.length, inputs.length);
    }
    
    return results;
  }

  /**
   * Get pool statistics
   */
  getStats(): WorkerPoolStats {
    // Estimate memory usage based on active tasks and queued tasks
    const estimatedMemoryUsage = (this.activeTasks.size + this.taskQueue.length) * 1024; // 1KB per task estimate
    
    return {
      totalWorkers: this.workers.length,
      availableWorkers: this.availableWorkers.length,
      activeTasks: this.activeTasks.size,
      queuedTasks: this.taskQueue.length,
      maxWorkers: this.maxWorkers,
      memoryUsage: estimatedMemoryUsage
    };
  }

  /**
   * Shut down the worker pool
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    
    console.log(`${this.name}: Shutting down worker pool...`);
    
    // Reject all queued tasks
    for (const task of this.taskQueue) {
      task.reject(new Error('Worker pool is shutting down'));
    }
    this.taskQueue.length = 0;

    // Wait for active tasks to complete or timeout
    const activeTaskPromises = Array.from(this.activeTasks.values()).map(task => 
      new Promise<void>((resolve) => {
        const originalResolve = task.resolve;
        const originalReject = task.reject;
        
        task.resolve = (result) => {
          originalResolve(result);
          resolve();
        };

        task.reject = (error) => {
          originalReject(error);
          resolve();
        };
      })
    );

    // Terminate all workers and clean up event listeners
    const terminatePromises = this.workers.map(async (worker) => {
      try {
        // Remove all event listeners before terminating
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        
        // Force terminate the worker
        worker.terminate();
        return Promise.resolve();
      } catch (error) {
        console.warn(`${this.name}: Error terminating worker:`, error);
        return Promise.resolve();
      }
    });

    try {
      await Promise.race([
        Promise.all(activeTaskPromises),
        new Promise(resolve => setTimeout(resolve, 5000)) // 5 second timeout
      ]);
    } catch {
      // Ignore timeout errors during shutdown
    }

    await Promise.all(terminatePromises);
    
    // Clear all arrays and maps
    this.workers.length = 0;
    this.availableWorkers.length = 0;
    this.activeTasks.clear();
    
    // Clear all event listeners to prevent memory leaks
    this.eventListeners.clear();
    
    this.emit('shutdown');
    console.log(`${this.name}: Worker pool shutdown complete`);
  }

  /**
   * Add event listener
   */
  on(event: string, listener: (data: unknown) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);
  }

  /**
   * Remove event listener
   */
  off(event: string, listener: (data: unknown) => void): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  /**
   * Emit event
   */
  private emit(event: string, data?: unknown): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(data);
        } catch (error) {
          console.error(`${this.name}: Error in event listener for ${event}:`, error);
        }
      }
    }
  }

  private processQueue(): void {
    while (this.taskQueue.length > 0) {
      const worker = this.getAvailableWorker();
      if (!worker) {
        break; // No workers available
      }
      
      const task = this.taskQueue.shift()!;
      this.assignTaskToWorker(task, worker);
    }
  }

  private getAvailableWorker(): Worker | null {
    if (this.availableWorkers.length > 0) {
      return this.availableWorkers.pop()!;
    }

    if (this.workers.length < this.maxWorkers) {
      try {
        return this.createWorker();
      } catch (error) {
        console.error(`${this.name}: Failed to create worker in getAvailableWorker:`, error);
        return null;
      }
    }

    return null;
  }

  private createWorker(): Worker {
    try {
      const worker = new Worker(this.workerScript, { type: 'classic' });
      
      worker.onerror = (error) => {
        this.handleWorkerError(worker, error);
      };

      worker.onmessageerror = (error) => {
        console.error(`${this.name}: Worker message error:`, error);
        this.handleWorkerError(worker, new Error('Worker message error'));
      };

      this.workers.push(worker);
      this.emit('workerCreated', { 
        workerId: this.workers.length - 1, 
        totalWorkers: this.workers.length 
      });
      
      return worker;
    } catch (error) {
      console.error(`${this.name}: Failed to create worker:`, error);
      throw new Error(`Failed to create worker: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private assignTaskToWorker(task: WorkerTask, worker: Worker): void {
    if (!worker) {
      task.reject(new Error('Worker is null'));
      return;
    }
    
    this.activeTasks.set(task.id, task);

    const timeoutId = setTimeout(() => {
      task.reject(new Error(`Task ${task.id} timed out after ${this.timeout}ms`));
      this.activeTasks.delete(task.id);
      this.recycleWorker(worker);
    }, this.timeout);

    const messageHandler = (event: MessageEvent) => {
      const { taskId, result, error } = event.data;
      
      if (taskId !== task.id) {
        return; // Not our task
      }

      clearTimeout(timeoutId);
      worker.removeEventListener('message', messageHandler);
      worker.removeEventListener('error', errorHandler);
      
      this.activeTasks.delete(task.id);
      
      if (error) {
        task.reject(new Error(error));
      } else {
        task.resolve(result);
      }
      
      this.recycleWorker(worker);
    };

    const errorHandler = (error: ErrorEvent) => {
      clearTimeout(timeoutId);
      worker.removeEventListener('message', messageHandler);
      worker.removeEventListener('error', errorHandler);
      
      this.activeTasks.delete(task.id);
      task.reject(new Error(`Worker error: ${error.message}`));
      this.handleWorkerError(worker, error);
    };

    worker.addEventListener('message', messageHandler);
    worker.addEventListener('error', errorHandler);
    
    // Send task to worker
    worker.postMessage({ 
      taskId: task.id, 
      input: task.input 
    });
  }

  private recycleWorker(worker: Worker): void {
    if (!this.isShuttingDown && this.workers.includes(worker)) {
      this.availableWorkers.push(worker);
      this.processQueue();
    }
  }

  private handleWorkerError(worker: Worker, error: Error | ErrorEvent): void {
    const errorMessage = error instanceof ErrorEvent ? error.message : error.message;
    this.emit('workerError', { 
      workerId: this.workers.indexOf(worker), 
      error: errorMessage 
    });
    
    // Clean up worker event listeners before removal
    try {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    } catch (terminateError) {
      console.warn(`${this.name}: Error during worker cleanup:`, terminateError);
    }
    
    // Remove worker from pools
    const workerIndex = this.workers.indexOf(worker);
    if (workerIndex !== -1) {
      this.workers.splice(workerIndex, 1);
    }

    const availableIndex = this.availableWorkers.indexOf(worker);
    if (availableIndex !== -1) {
      this.availableWorkers.splice(availableIndex, 1);
    }

    // Try to replace the worker if not shutting down
    if (!this.isShuttingDown && this.workers.length < this.maxWorkers) {
      this.processQueue();
    }
  }

  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Specialized worker pool for file processing
 */
export class FileProcessingPool extends WebWorkerPool {
  private static instance: FileProcessingPool;

  static getInstance(): FileProcessingPool {
    if (!FileProcessingPool.instance) {
      FileProcessingPool.instance = new FileProcessingPool({
        maxWorkers: Math.max(2, Math.min(6, navigator.hardwareConcurrency || 4)),
        workerScript: '/workers/file-processing-worker.js',
        timeout: 45000, // 45 seconds for file processing
        name: 'FileProcessingPool'
      });
    }
    return FileProcessingPool.instance;
  }

  /**
   * Shutdown and clear the singleton instance to prevent memory leaks
   */
  static async shutdownInstance(): Promise<void> {
    if (FileProcessingPool.instance) {
      await FileProcessingPool.instance.shutdown();
      FileProcessingPool.instance = undefined as any;
    }
  }

  /**
   * Check if singleton instance exists
   */
  static hasInstance(): boolean {
    return FileProcessingPool.instance !== null && FileProcessingPool.instance !== undefined;
  }

  /**
   * Process files in parallel
   */
  async processFiles<TOutput>(
    filePaths: string[], 
    processor: (filePath: string) => Promise<TOutput>
  ): Promise<TOutput[]> {
    const processingTasks = filePaths.map(filePath => ({
      filePath,
      processorFunction: processor.toString()
    }));

    return this.executeAll(processingTasks);
  }

  /**
   * Process files with progress callback
   */
  async processFilesWithProgress<TOutput>(
    filePaths: string[], 
    processor: (filePath: string) => Promise<TOutput>,
    onProgress?: (completed: number, total: number) => void
  ): Promise<TOutput[]> {
    return this.executeWithProgress(
      filePaths.map(filePath => ({ filePath, processorFunction: processor.toString() })),
      onProgress
    );
  }
}

/**
 * Worker pool utilities - simplified for GitNexus
 */
export const WebWorkerPoolUtils = {
  /**
   * Create a worker pool using GitNexus configuration
   */
  async createWorkerPool(options: Partial<WorkerPoolOptions> = {}): Promise<WebWorkerPool> {
    console.log('🔧 WebWorkerPoolUtils: Loading config and calculating workers...');
    
    // Import config loader dynamically to avoid circular dependencies
    const { ConfigLoader } = await import('../config/config-loader.ts');
    const { calculateWorkerCount } = await import('./worker-calculator.ts');
    
    console.log('🔧 WebWorkerPoolUtils: Imports loaded, getting config...');
    const config = await ConfigLoader.getInstance().loadConfig();
    console.log('🔧 WebWorkerPoolUtils: Config loaded, calculating worker count...');
    const workerCalc = await calculateWorkerCount(config);
    console.log('🔧 WebWorkerPoolUtils: Worker calculation complete:', workerCalc.workerCount);
    
    console.log(''); // Empty line for better readability
    console.log('🔧 GitNexus Worker Pool Initialization');
    console.log('='.repeat(50));
    
    console.log('🔧 WebWorkerPoolUtils: Creating WebWorkerPool with options:', {
      maxWorkers: workerCalc.workerCount,
      timeout: config.processing.parallel.workerTimeoutMs,
      name: 'GitNexusWorkerPool',
      ...options
    });
    
    const workerPool = new WebWorkerPool({
      maxWorkers: workerCalc.workerCount,
      timeout: config.processing.parallel.workerTimeoutMs,
      name: 'GitNexusWorkerPool',
      ...options
    });
    
    console.log('🔧 WebWorkerPoolUtils: WebWorkerPool created, maxWorkers:', workerPool.maxWorkersCount);
    
    console.log('='.repeat(50));
    console.log('✅ Worker pool created successfully');
    console.log(''); // Empty line for better readability
    
    return workerPool;
  },

  /**
   * Legacy method - redirects to new simplified approach
   * @deprecated Use createWorkerPool() instead
   */
  createCPUPool(options: Partial<WorkerPoolOptions> = {}): Promise<WebWorkerPool> {
    return this.createWorkerPool(options);
  },

  /**
   * Check if Web Workers are supported
   */
  isSupported(): boolean {
    return typeof Worker !== 'undefined';
  },

  /**
   * Get system information for debugging
   */
  async getSystemInfo() {
    const { getSystemInfoForDebug } = await import('./worker-calculator.ts');
    return getSystemInfoForDebug();
  },

  /**
   * Cleanup all singleton worker pool instances
   */
  async cleanupAllPools(): Promise<void> {
    // Cleanup FileProcessingPool if it exists
    if (FileProcessingPool.hasInstance()) {
      await FileProcessingPool.shutdownInstance();
    }
    
    console.log('🧹 Worker pool cleanup completed');
  }
};
