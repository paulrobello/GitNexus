/**
 * Legacy Ingestion Service
 * 
 * Concrete implementation of BaseIngestionService for Legacy engine.
 * Uses parallel processing with in-memory graph storage.
 * 
 * Engine characteristics:
 * - Parallel processing (multi-threaded with Web Workers)
 * - In-memory graph storage (SimpleKnowledgeGraph)
 * - Worker-based processing for isolation
 * - JSON serialization for data transfer
 */

import { BaseIngestionService, type BaseIngestionOptions, type BaseIngestionResult } from '../common/base-ingestion.service';
import { getIngestionWorker } from '../../lib/workerUtils';
import type { KnowledgeGraph } from '../../core/graph/types';

export interface LegacyIngestionOptions extends BaseIngestionOptions {
  // Legacy-specific options can be added here
}

export interface LegacyIngestionResult extends BaseIngestionResult {
  graph: KnowledgeGraph;
}

/**
 * Legacy Ingestion Service
 * Wraps the original sequential + in-memory processing system
 */
export class LegacyIngestionService extends BaseIngestionService {
  
  /**
   * Process pipeline using Legacy engine (sequential + in-memory)
   */
  protected async processPipeline(data: {
    projectName: string;
    projectRoot: string;
    filePaths: string[];
    fileContents: Map<string, string>;
    onProgress?: (message: string) => void;
  }): Promise<LegacyIngestionResult> {
    
    const { projectName, projectRoot, filePaths, fileContents, onProgress } = data;
    
    console.log('🔧 Legacy Engine: Using parallel processing with in-memory storage');
    
    // Create worker for processing isolation
    const worker = await getIngestionWorker();
    
    try {
      onProgress?.('Processing with Legacy engine (parallel + in-memory)...');
      
      const result = await worker.processRepository({
        projectName,
        projectRoot,
        filePaths,
        fileContents: fileContents
      });

      if (!result.success) {
        throw new Error(result.error || 'Legacy processing failed');
      }

      console.log('✅ Legacy Engine: Parallel processing completed successfully');
      console.log(`📊 Legacy Engine: Generated ${result.graph!.nodes.length} nodes, ${result.graph!.relationships.length} relationships`);

      return {
        graph: result.graph!,
        fileContents
      };
      
    } catch (error) {
      console.error('❌ Legacy Engine: Processing failed:', error);
      throw error;
    } finally {
      // Clean up worker
      if ('terminate' in worker) {
        (worker as { terminate: () => void }).terminate();
      }
    }
  }

  /**
   * Legacy-specific processing options
   */
  async processGitHubRepo(
    githubUrl: string, 
    options: LegacyIngestionOptions = {}
  ): Promise<LegacyIngestionResult> {
    
    console.log('🚀 Legacy Ingestion Service: Starting GitHub repository processing');
    console.log(`🔧 Processing mode: Parallel + In-Memory`);
    
    return super.processGitHubRepo(githubUrl, options) as Promise<LegacyIngestionResult>;
  }

  /**
   * Legacy-specific ZIP file processing
   */
  async processZipFile(
    file: File,
    options: LegacyIngestionOptions = {}
  ): Promise<LegacyIngestionResult> {
    
    console.log('🚀 Legacy Ingestion Service: Starting ZIP file processing');
    console.log(`🔧 Processing mode: Parallel + In-Memory`);
    
    return super.processZipFile(file, options) as Promise<LegacyIngestionResult>;
  }
}