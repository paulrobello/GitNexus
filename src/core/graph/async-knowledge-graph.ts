/**
 * Async Knowledge Graph Interface for Direct KuzuDB Writes
 * 
 * This interface supports both sync and async operations to enable
 * gradual migration from batched to direct writes.
 */

import type { GraphNode, GraphRelationship } from './types.ts';

export interface AsyncKnowledgeGraph {
  nodes: GraphNode[];
  relationships: GraphRelationship[];
  
  // Sync methods (backward compatibility)
  addNode(node: GraphNode): void;
  addRelationship(relationship: GraphRelationship): void;
  
  // Async methods (new direct-write capability)
  addNodeAsync(node: GraphNode): Promise<void>;
  addRelationshipAsync(relationship: GraphRelationship): Promise<void>;
  
  // Batch operations
  addNodesBatch(nodes: GraphNode[]): Promise<void>;
  addRelationshipsBatch(relationships: GraphRelationship[]): Promise<void>;
  
  // Transaction support
  beginTransaction(): Promise<void>;
  commitTransaction(): Promise<void>;
  rollbackTransaction(): Promise<void>;
  
  // Utility methods
  flushPendingOperations(): Promise<void>;
  getStats(): {
    pendingNodes: number;
    pendingRelationships: number;
    totalNodes: number;
    totalRelationships: number;
  };
}

/**
 * Configuration for direct-write behavior
 */
export interface DirectWriteOptions {
  enableDirectWrites: boolean;
  batchSize: number;
  maxConcurrentWrites: number;
  retryAttempts: number;
  retryDelayMs: number;
  fallbackToBatching: boolean;
  enableTransactions: boolean;
}

export const DEFAULT_DIRECT_WRITE_OPTIONS: DirectWriteOptions = {
  enableDirectWrites: true,
  batchSize: 50,
  maxConcurrentWrites: 10,
  retryAttempts: 3,
  retryDelayMs: 100,
  fallbackToBatching: true,
  enableTransactions: true
};
