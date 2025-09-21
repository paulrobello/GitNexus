/**
 * Direct-Write Knowledge Graph Implementation
 * 
 * This implementation writes directly to KuzuDB during processing,
 * eliminating the 25+ second flush delay while maintaining reliability.
 */

import type { KnowledgeGraph, GraphNode, GraphRelationship } from './types.ts';
import type { AsyncKnowledgeGraph, DirectWriteOptions } from './async-knowledge-graph.ts';
import { SimpleKnowledgeGraph } from './graph.ts';
import type { KuzuKnowledgeGraph } from './kuzu-knowledge-graph.ts';
import { DEFAULT_DIRECT_WRITE_OPTIONS } from './async-knowledge-graph.ts';
// NODE_TABLE_SCHEMAS import removed - now using KuzuKnowledgeGraph's schema filtering

export class DirectWriteKnowledgeGraph implements KnowledgeGraph, AsyncKnowledgeGraph {
  private jsonGraph: SimpleKnowledgeGraph;
  private kuzuGraph: KuzuKnowledgeGraph | null;
  private options: DirectWriteOptions;
  private enableKuzuDB: boolean;
  
  // Performance tracking
  private stats = {
    nodesWrittenToJSON: 0,
    nodesWrittenToKuzuDB: 0,
    relationshipsWrittenToJSON: 0,
    relationshipsWrittenToKuzuDB: 0,
    directWriteSuccesses: 0,
    directWriteFailures: 0,
    fallbackToBatch: 0,
    averageWriteTimeMs: 0
  };
  
  // Concurrency control
  private activeWrites = new Set<Promise<void>>();
  private writeQueue: Array<() => Promise<void>> = [];
  private isProcessingQueue = false;
  
  // Transaction state
  private transactionActive = false;
  private transactionOperations: Array<() => Promise<void>> = [];

  constructor(kuzuGraph?: KuzuKnowledgeGraph, options: Partial<DirectWriteOptions> = {}) {
    this.jsonGraph = new SimpleKnowledgeGraph();
    this.kuzuGraph = kuzuGraph || null;
    this.enableKuzuDB = !!kuzuGraph;
    this.options = { ...DEFAULT_DIRECT_WRITE_OPTIONS, ...options };
  }

  /**
   * Get all nodes (from JSON primary storage)
   */
  get nodes(): GraphNode[] {
    return this.jsonGraph.nodes;
  }

  /**
   * Get all relationships (from JSON primary storage)
   */
  get relationships(): GraphRelationship[] {
    return this.jsonGraph.relationships;
  }

  /**
   * Synchronous addNode (backward compatibility)
   * Uses fire-and-forget async write to KuzuDB
   */
  addNode(node: GraphNode): void {
    // Always write to JSON immediately (primary storage)
    this.jsonGraph.addNode(node);
    this.stats.nodesWrittenToJSON++;

    // Fire-and-forget direct write to KuzuDB
    if (this.enableKuzuDB && this.options.enableDirectWrites) {
      console.log(`⚡ DIRECT-WRITE: Adding ${node.label} node ${node.id} to KuzuDB - NEW CODE!`);
      this.addNodeAsync(node).catch(error => {
        console.warn(`❌ DIRECT-WRITE: KuzuDB write failed for node ${node.id}:`, error);
        this.stats.directWriteFailures++;
      });
    } else {
      console.log(`🔄 DIRECT-WRITE: Direct writes disabled - KuzuDB: ${this.enableKuzuDB}, DirectWrites: ${this.options.enableDirectWrites}`);
    }
  }

  /**
   * Synchronous addRelationship (backward compatibility)
   */
  addRelationship(relationship: GraphRelationship): void {
    // Always write to JSON immediately
    this.jsonGraph.addRelationship(relationship);
    this.stats.relationshipsWrittenToJSON++;

    // Fire-and-forget direct write to KuzuDB
    if (this.enableKuzuDB && this.options.enableDirectWrites) {
      this.addRelationshipAsync(relationship).catch(error => {
        console.warn(`Direct KuzuDB write failed for relationship ${relationship.id}:`, error);
        this.stats.directWriteFailures++;
      });
    }
  }

  /**
   * Async addNode with proper error handling and concurrency control
   */
  async addNodeAsync(node: GraphNode): Promise<void> {
    if (!this.enableKuzuDB || !this.kuzuGraph) return;

    const writeOperation = async () => {
      const startTime = performance.now();
      
      try {
        // Wait for available slot if too many concurrent writes
        await this.waitForWriteSlot();
        
        if (this.transactionActive) {
          // Add to transaction queue
          this.transactionOperations.push(() => this.executeNodeWrite(node));
        } else {
          // Execute immediately
          await this.executeNodeWrite(node);
        }
        
        this.stats.directWriteSuccesses++;
        this.stats.nodesWrittenToKuzuDB++;
        
        // Update average write time
        const writeTime = performance.now() - startTime;
        this.updateAverageWriteTime(writeTime);
        
      } catch (error) {
        this.stats.directWriteFailures++;
        
        if (this.options.fallbackToBatching) {
          console.warn(`Direct write failed for node ${node.id}, adding to batch queue:`, error);
          this.stats.fallbackToBatch++;
          // Add to KuzuDB's internal batch queue as fallback
          this.kuzuGraph.addNode(node);
        } else {
          throw error;
        }
      }
    };

    if (this.options.maxConcurrentWrites > 1) {
      // Add to queue for concurrent processing
      this.writeQueue.push(writeOperation);
      this.processWriteQueue();
    } else {
      // Execute immediately (sequential mode)
      await writeOperation();
    }
  }

  /**
   * Async addRelationship with proper error handling
   */
  async addRelationshipAsync(relationship: GraphRelationship): Promise<void> {
    if (!this.enableKuzuDB || !this.kuzuGraph) return;

    const writeOperation = async () => {
      const startTime = performance.now();
      
      try {
        await this.waitForWriteSlot();
        
        if (this.transactionActive) {
          this.transactionOperations.push(() => this.executeRelationshipWrite(relationship));
        } else {
          await this.executeRelationshipWrite(relationship);
        }
        
        this.stats.directWriteSuccesses++;
        this.stats.relationshipsWrittenToKuzuDB++;
        
        const writeTime = performance.now() - startTime;
        this.updateAverageWriteTime(writeTime);
        
      } catch (error) {
        this.stats.directWriteFailures++;
        
        if (this.options.fallbackToBatching) {
          console.warn(`Direct write failed for relationship ${relationship.id}, adding to batch queue:`, error);
          this.stats.fallbackToBatch++;
          this.kuzuGraph.addRelationship(relationship);
        } else {
          throw error;
        }
      }
    };

    if (this.options.maxConcurrentWrites > 1) {
      this.writeQueue.push(writeOperation);
      this.processWriteQueue();
    } else {
      await writeOperation();
    }
  }

  /**
   * Execute actual node write to KuzuDB (reuses proven KuzuKnowledgeGraph logic)
   */
  private async executeNodeWrite(node: GraphNode): Promise<void> {
    if (!this.kuzuGraph) return;
    
    // Reuse the existing, tested commitSingleNode method with schema filtering and auto-recovery
    await this.kuzuGraph.commitSingleNode(node);
  }

  /**
   * Execute actual relationship write to KuzuDB (reuses proven KuzuKnowledgeGraph logic)
   */
  private async executeRelationshipWrite(relationship: GraphRelationship): Promise<void> {
    if (!this.kuzuGraph) return;
    
    // Reuse the existing, tested commitSingleRelationship method with auto-recovery
    await this.kuzuGraph.commitSingleRelationship(relationship);
  }

  // Query building methods removed - now reusing KuzuKnowledgeGraph's proven implementation

  // All schema filtering, property formatting, and query execution logic
  // has been removed - now reusing KuzuKnowledgeGraph's proven methods
  // This eliminates ~100 lines of duplicate code and prevents schema issues

  /**
   * Wait for available write slot (concurrency control)
   */
  private async waitForWriteSlot(): Promise<void> {
    while (this.activeWrites.size >= this.options.maxConcurrentWrites) {
      await Promise.race(this.activeWrites);
    }
  }

  /**
   * Process write queue with concurrency control
   */
  private async processWriteQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    while (this.writeQueue.length > 0 && this.activeWrites.size < this.options.maxConcurrentWrites) {
      const operation = this.writeQueue.shift();
      if (operation) {
        const promise = operation().finally(() => {
          this.activeWrites.delete(promise);
        });
        this.activeWrites.add(promise);
      }
    }

    this.isProcessingQueue = false;
  }

  /**
   * Transaction support
   */
  async beginTransaction(): Promise<void> {
    this.transactionActive = true;
    this.transactionOperations = [];
  }

  async commitTransaction(): Promise<void> {
    if (!this.transactionActive) return;
    
    try {
      // Execute all queued operations
      for (const operation of this.transactionOperations) {
        await operation();
      }
      
      this.transactionOperations = [];
      this.transactionActive = false;
    } catch (error) {
      await this.rollbackTransaction();
      throw error;
    }
  }

  async rollbackTransaction(): Promise<void> {
    this.transactionOperations = [];
    this.transactionActive = false;
  }

  /**
   * Batch operations for bulk inserts
   */
  async addNodesBatch(nodes: GraphNode[]): Promise<void> {
    await this.beginTransaction();
    try {
      for (const node of nodes) {
        await this.addNodeAsync(node);
      }
      await this.commitTransaction();
    } catch (error) {
      await this.rollbackTransaction();
      throw error;
    }
  }

  async addRelationshipsBatch(relationships: GraphRelationship[]): Promise<void> {
    await this.beginTransaction();
    try {
      for (const relationship of relationships) {
        await this.addRelationshipAsync(relationship);
      }
      await this.commitTransaction();
    } catch (error) {
      await this.rollbackTransaction();
      throw error;
    }
  }

  /**
   * Flush any pending operations (for compatibility)
   */
  async flushPendingOperations(): Promise<void> {
    console.log('🚀 DIRECT-WRITE: flushPendingOperations() called - NEW CODE RUNNING!');
    console.log(`📊 DIRECT-WRITE: Stats - fallbackToBatch: ${this.stats.fallbackToBatch}, directWriteSuccesses: ${this.stats.directWriteSuccesses}, directWriteFailures: ${this.stats.directWriteFailures}`);
    
    // Debug: Check if KuzuGraph has pending operations
    if (this.kuzuGraph) {
      const pendingNodes = (this.kuzuGraph as any).pendingNodes?.length || 0;
      const pendingRels = (this.kuzuGraph as any).pendingRelationships?.length || 0;
      console.log(`🔍 DIRECT-WRITE: KuzuGraph has ${pendingNodes} pending nodes, ${pendingRels} pending relationships`);
    }
    
    // Wait for all active writes to complete
    await Promise.all(this.activeWrites);
    
    // Process any remaining queue items
    while (this.writeQueue.length > 0) {
      await this.processWriteQueue();
      await Promise.all(this.activeWrites);
    }
    
    // Only flush fallback batched operations if there were actual fallbacks
    if (this.kuzuGraph && 'commitAll' in this.kuzuGraph && this.stats.fallbackToBatch > 0) {
      console.log(`🔄 DIRECT-WRITE: Flushing ${this.stats.fallbackToBatch} fallback operations that failed direct write...`);
      await (this.kuzuGraph as any).commitAll();
    } else {
      console.log('✅ DIRECT-WRITE: No fallback operations to flush - all direct writes succeeded!');
      
      // BUT: Check if KuzuGraph has pending operations anyway (this shouldn't happen!)
      if (this.kuzuGraph) {
        const pendingNodes = (this.kuzuGraph as any).pendingNodes?.length || 0;
        const pendingRels = (this.kuzuGraph as any).pendingRelationships?.length || 0;
        if (pendingNodes > 0 || pendingRels > 0) {
          console.warn(`🚨 DIRECT-WRITE: BUG DETECTED! KuzuGraph has ${pendingNodes} pending nodes, ${pendingRels} pending relationships despite no fallbacks!`);
          console.warn('🚨 DIRECT-WRITE: This means something is calling kuzuGraph.addNode() directly, bypassing DirectWriteKnowledgeGraph!');
          console.warn('🚨 DIRECT-WRITE: Flushing these unexpected pending operations...');
          await (this.kuzuGraph as any).commitAll();
        }
      }
    }
  }

  /**
   * Get performance statistics
   */
  getStats() {
    return {
      ...this.stats,
      pendingNodes: 0, // Direct writes don't queue
      pendingRelationships: 0,
      totalNodes: this.jsonGraph.nodes.length,
      totalRelationships: this.jsonGraph.relationships.length,
      activeWrites: this.activeWrites.size,
      queuedWrites: this.writeQueue.length
    };
  }

  /**
   * Log performance statistics
   */
  logStats(): void {
    const stats = this.getStats();
    console.log('📊 Direct-Write Statistics:');
    console.log(`  JSON entities: ${stats.nodesWrittenToJSON + stats.relationshipsWrittenToJSON}`);
    console.log(`  KuzuDB entities: ${stats.nodesWrittenToKuzuDB + stats.relationshipsWrittenToKuzuDB}`);
    console.log(`  Direct write successes: ${stats.directWriteSuccesses}`);
    console.log(`  Direct write failures: ${stats.directWriteFailures}`);
    console.log(`  Fallback to batch: ${stats.fallbackToBatch}`);
    console.log(`  Average write time: ${stats.averageWriteTimeMs.toFixed(2)}ms`);
    
    const successRate = stats.directWriteSuccesses + stats.directWriteFailures > 0 
      ? (stats.directWriteSuccesses / (stats.directWriteSuccesses + stats.directWriteFailures) * 100).toFixed(1)
      : '100';
    console.log(`  Success rate: ${successRate}%`);
  }

  /**
   * Utility methods
   */
  private updateAverageWriteTime(newTime: number): void {
    const totalWrites = this.stats.directWriteSuccesses + this.stats.directWriteFailures;
    this.stats.averageWriteTimeMs = (this.stats.averageWriteTimeMs * (totalWrites - 1) + newTime) / totalWrites;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
