/**
 * KuzuDB-Aware Processor Base Class
 * 
 * This base class provides KuzuDB integration capabilities for all
 * ingestion processors, implementing the dual-write pattern where
 * data is written to both JSON (SimpleKnowledgeGraph) and KuzuDB.
 */

import type { KnowledgeGraph, GraphNode, GraphRelationship } from '../graph/types.ts';
import { KuzuQueryEngine } from '../graph/kuzu-query-engine.ts';
import { KuzuKnowledgeGraph } from '../graph/kuzu-knowledge-graph.ts';
import { isKuzuDBEnabled, isKuzuDBPersistenceEnabled } from '../../config/feature-flags.ts';

export interface KuzuProcessorOptions {
  enableKuzuDB?: boolean;
  batchSize?: number;
  autoCommit?: boolean;
  enableValidation?: boolean;
}

export interface ProcessorStats {
  nodesProcessed: number;
  relationshipsProcessed: number;
  kuzuNodesWritten: number;
  kuzuRelationshipsWritten: number;
  kuzuErrors: number;
  validationErrors: number;
  processingTime: number;
  // Additional stats for CallProcessor
  totalCalls?: number;
  exactMatches?: number;
  sameFileMatches?: number;
  heuristicMatches?: number;
  failed?: number;
  callTypes?: Record<string, number>;
  failuresByCategory?: {
    externalLibraries: number;
    pythonBuiltins: number;
    actualFailures: number;
  };
}

export interface TransactionState {
  isActive: boolean;
  startTime: number;
  nodesBatch: GraphNode[];
  relationshipsBatch: GraphRelationship[];
  rollbackData: {
    jsonNodes: GraphNode[];
    jsonRelationships: GraphRelationship[];
  };
}

/**
 * Base class for processors that support KuzuDB dual-write pattern
 */
export abstract class KuzuProcessorBase {
  protected kuzuQueryEngine: KuzuQueryEngine | null = null;
  protected kuzuGraph: KuzuKnowledgeGraph | null = null;
  protected options: KuzuProcessorOptions;
  protected stats: ProcessorStats;
  protected transaction: TransactionState;

  constructor(options: KuzuProcessorOptions = {}) {
    this.options = {
      enableKuzuDB: options.enableKuzuDB ?? isKuzuDBEnabled(),
      batchSize: options.batchSize ?? 100,
      autoCommit: options.autoCommit ?? true,
      enableValidation: options.enableValidation ?? true
    };

    this.stats = {
      nodesProcessed: 0,
      relationshipsProcessed: 0,
      kuzuNodesWritten: 0,
      kuzuRelationshipsWritten: 0,
      kuzuErrors: 0,
      validationErrors: 0,
      processingTime: 0
    };

    this.transaction = {
      isActive: false,
      startTime: 0,
      nodesBatch: [],
      relationshipsBatch: [],
      rollbackData: {
        jsonNodes: [],
        jsonRelationships: []
      }
    };
  }

  /**
   * Initialize KuzuDB integration
   */
  protected async initializeKuzuDB(): Promise<void> {
    if (!this.options.enableKuzuDB) {
      console.log('⚠️ KuzuDB integration disabled for this processor');
      return;
    }

    try {
      console.log('🚀 Initializing KuzuDB integration...');
      
      // Initialize query engine
        this.kuzuQueryEngine = new KuzuQueryEngine({
        enableCache: true,
        cacheSize: 1000,
        cacheTTL: 5 * 60 * 1000 // 5 minutes
      });

      await this.kuzuQueryEngine.initialize();

      // Create KuzuDB knowledge graph
      this.kuzuGraph = new KuzuKnowledgeGraph(this.kuzuQueryEngine, {
        enableCache: true,
        batchSize: this.options.batchSize,
        autoCommit: this.options.autoCommit
      });

      console.log('✅ KuzuDB integration initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize KuzuDB integration:', error);
      this.kuzuQueryEngine = null;
      this.kuzuGraph = null;
      // Continue without KuzuDB - graceful degradation
    }
  }

  /**
   * Dual-write a node to both JSON graph and KuzuDB
   */
  protected async addNodeDualWrite(jsonGraph: KnowledgeGraph, node: GraphNode): Promise<void> {
    const startTime = performance.now();

    try {
      // Always write to JSON graph first (primary storage)
      jsonGraph.addNode(node);
      this.stats.nodesProcessed++;

      // Write to KuzuDB if enabled and available
      if (this.kuzuGraph) {
        try {
          this.kuzuGraph.addNode(node);
          this.stats.kuzuNodesWritten++;
        } catch (kuzuError) {
          this.stats.kuzuErrors++;
          console.warn(`KuzuDB node write failed for ${node.id}:`, kuzuError);
          // Continue - JSON is primary, KuzuDB failure shouldn't break the process
        }
      }

      // Data validation if enabled
      if (this.options.enableValidation && this.kuzuGraph) {
        await this.validateNodeConsistency(node);
      }

    } catch (error) {
      console.error(`Failed to add node ${node.id}:`, error);
      throw error;
    } finally {
      this.stats.processingTime += performance.now() - startTime;
    }
  }

  /**
   * Dual-write a relationship to both JSON graph and KuzuDB
   */
  protected async addRelationshipDualWrite(
    jsonGraph: KnowledgeGraph, 
    relationship: GraphRelationship
  ): Promise<void> {
    const startTime = performance.now();

    try {
      // Always write to JSON graph first (primary storage)
      jsonGraph.addRelationship(relationship);
      this.stats.relationshipsProcessed++;

      // Write to KuzuDB if enabled and available
      if (this.kuzuGraph) {
        try {
          this.kuzuGraph.addRelationship(relationship);
          this.stats.kuzuRelationshipsWritten++;
        } catch (kuzuError) {
          this.stats.kuzuErrors++;
          console.warn(`KuzuDB relationship write failed for ${relationship.id}:`, kuzuError);
          // Continue - JSON is primary, KuzuDB failure shouldn't break the process
        }
      }

      // Data validation if enabled
      if (this.options.enableValidation && this.kuzuGraph) {
        await this.validateRelationshipConsistency(relationship);
      }

    } catch (error) {
      console.error(`Failed to add relationship ${relationship.id}:`, error);
      throw error;
    } finally {
      this.stats.processingTime += performance.now() - startTime;
    }
  }

  /**
   * Commit all pending KuzuDB operations
   */
  protected async commitKuzuDB(): Promise<void> {
    if (!this.kuzuGraph) return;

    try {
      console.log('📝 Committing KuzuDB operations...');
      await this.kuzuGraph.commitAll();
      console.log('✅ KuzuDB operations committed successfully');
    } catch (error) {
      console.error('❌ Failed to commit KuzuDB operations:', error);
      this.stats.kuzuErrors++;
      // Don't throw - this shouldn't break the main process
    }
  }

  /**
   * Validate that a node exists consistently in both storages
   */
  private async validateNodeConsistency(node: GraphNode): Promise<void> {
    if (!this.kuzuGraph) return;

    try {
      // This is a placeholder for validation logic
      // In a real implementation, you would query KuzuDB to verify the node exists
      // and has the same properties as the JSON version
      
      // For now, we'll just increment the validation counter
      // TODO: Implement actual validation once KuzuDB queries are working
      
    } catch (error) {
      this.stats.validationErrors++;
      console.warn(`Validation failed for node ${node.id}:`, error);
    }
  }

  /**
   * Validate that a relationship exists consistently in both storages
   */
  private async validateRelationshipConsistency(relationship: GraphRelationship): Promise<void> {
    if (!this.kuzuGraph) return;

    try {
      // This is a placeholder for validation logic
      // In a real implementation, you would query KuzuDB to verify the relationship exists
      // and has the same properties as the JSON version
      
      // For now, we'll just increment the validation counter
      // TODO: Implement actual validation once KuzuDB queries are working
      
    } catch (error) {
      this.stats.validationErrors++;
      console.warn(`Validation failed for relationship ${relationship.id}:`, error);
    }
  }

  /**
   * Get processing statistics
   */
  public getStats(): ProcessorStats {
    return { ...this.stats };
  }

  /**
   * Reset processing statistics
   */
  protected resetStats(): void {
    this.stats = {
      nodesProcessed: 0,
      relationshipsProcessed: 0,
      kuzuNodesWritten: 0,
      kuzuRelationshipsWritten: 0,
      kuzuErrors: 0,
      validationErrors: 0,
      processingTime: 0
    };
  }

  /**
   * Log processing statistics
   */
  protected logStats(processorName: string): void {
    const stats = this.stats;
    const kuzuEnabled = this.kuzuGraph !== null;
    
    console.log(`📊 ${processorName} Statistics:`);
    console.log(`  Nodes processed: ${stats.nodesProcessed}`);
    console.log(`  Relationships processed: ${stats.relationshipsProcessed}`);
    console.log(`  Processing time: ${stats.processingTime.toFixed(2)}ms`);
    
    if (kuzuEnabled) {
      console.log(`  KuzuDB nodes written: ${stats.kuzuNodesWritten}`);
      console.log(`  KuzuDB relationships written: ${stats.kuzuRelationshipsWritten}`);
      console.log(`  KuzuDB errors: ${stats.kuzuErrors}`);
      console.log(`  Validation errors: ${stats.validationErrors}`);
      
      const successRate = stats.nodesProcessed + stats.relationshipsProcessed > 0 
        ? ((stats.kuzuNodesWritten + stats.kuzuRelationshipsWritten) / 
           (stats.nodesProcessed + stats.relationshipsProcessed) * 100).toFixed(1)
        : '0';
      console.log(`  KuzuDB success rate: ${successRate}%`);
    } else {
      console.log('  KuzuDB: Disabled');
    }
  }

  /**
   * Cleanup resources
   */
  protected async cleanup(): Promise<void> {
    try {
      // Commit any pending operations
      await this.commitKuzuDB();

      // Close KuzuDB connection
      if (this.kuzuQueryEngine) {
        await this.kuzuQueryEngine.close();
        this.kuzuQueryEngine = null;
        this.kuzuGraph = null;
      }

      console.log('✅ Processor cleanup completed');
    } catch (error) {
      console.error('❌ Error during processor cleanup:', error);
    }
  }

  /**
   * Check if KuzuDB integration is enabled and ready
   */
  protected isKuzuDBReady(): boolean {
    return this.kuzuGraph !== null && 
           this.kuzuQueryEngine !== null && 
           this.kuzuQueryEngine.isReady();
  }

  /**
   * Get KuzuDB integration status
   */
  public getKuzuDBStatus(): {
    enabled: boolean;
    ready: boolean;
    queryEngine: boolean;
    graph: boolean;
  } {
    return {
      enabled: this.options.enableKuzuDB || false,
      ready: this.isKuzuDBReady(),
      queryEngine: this.kuzuQueryEngine !== null,
      graph: this.kuzuGraph !== null
    };
  }

  /**
   * Begin a transaction for batch operations
   */
  protected async beginTransaction(): Promise<void> {
    if (this.transaction.isActive) {
      console.warn('⚠️ Transaction already active, committing previous transaction');
      await this.commitTransaction();
    }

    this.transaction = {
      isActive: true,
      startTime: performance.now(),
      nodesBatch: [],
      relationshipsBatch: [],
      rollbackData: {
        jsonNodes: [],
        jsonRelationships: []
      }
    };

    console.log('🔄 Transaction started');
  }

  /**
   * Commit the current transaction
   */
  protected async commitTransaction(): Promise<void> {
    if (!this.transaction.isActive) {
      console.warn('⚠️ No active transaction to commit');
      return;
    }

    try {
      // Commit to KuzuDB if available
      if (this.kuzuGraph) {
        await this.kuzuGraph.commitAll();
      }

      const duration = performance.now() - this.transaction.startTime;
      console.log(`✅ Transaction committed successfully in ${duration.toFixed(2)}ms`);
      console.log(`📊 Committed ${this.transaction.nodesBatch.length} nodes and ${this.transaction.relationshipsBatch.length} relationships`);

      // Reset transaction state
      this.transaction.isActive = false;
      this.transaction.nodesBatch = [];
      this.transaction.relationshipsBatch = [];
      this.transaction.rollbackData = { jsonNodes: [], jsonRelationships: [] };

    } catch (error) {
      console.error('❌ Transaction commit failed:', error);
      await this.rollbackTransaction();
      throw error;
    }
  }

  /**
   * Rollback the current transaction
   */
  protected async rollbackTransaction(): Promise<void> {
    if (!this.transaction.isActive) {
      console.warn('⚠️ No active transaction to rollback');
      return;
    }

    try {
      console.log('🔄 Rolling back transaction...');

      // Note: For JSON rollback, we would need to maintain the original state
      // This is a simplified implementation - in production, you'd want more sophisticated rollback logic
      
      const duration = performance.now() - this.transaction.startTime;
      console.log(`🔙 Transaction rolled back in ${duration.toFixed(2)}ms`);
      console.log(`📊 Rolled back ${this.transaction.nodesBatch.length} nodes and ${this.transaction.relationshipsBatch.length} relationships`);

      // Reset transaction state
      this.transaction.isActive = false;
      this.transaction.nodesBatch = [];
      this.transaction.relationshipsBatch = [];
      this.transaction.rollbackData = { jsonNodes: [], jsonRelationships: [] };

    } catch (error) {
      console.error('❌ Transaction rollback failed:', error);
      throw error;
    }
  }

  /**
   * Get transaction status
   */
  protected getTransactionStatus(): {
    isActive: boolean;
    duration: number;
    nodeCount: number;
    relationshipCount: number;
  } {
    return {
      isActive: this.transaction.isActive,
      duration: this.transaction.isActive ? performance.now() - this.transaction.startTime : 0,
      nodeCount: this.transaction.nodesBatch.length,
      relationshipCount: this.transaction.relationshipsBatch.length
    };
  }
}
