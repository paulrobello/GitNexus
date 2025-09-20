/**
 * Dual-Write Knowledge Graph Implementation
 * 
 * This class implements transparent dual-write functionality, writing data to both
 * JSON (SimpleKnowledgeGraph) and KuzuDB simultaneously. The JSON storage remains
 * the primary source of truth, while KuzuDB provides enhanced query capabilities.
 */

import type { KnowledgeGraph, GraphNode, GraphRelationship } from './types.ts';
import { SimpleKnowledgeGraph } from './graph.ts';
import type { KuzuKnowledgeGraph } from './kuzu-knowledge-graph.ts';

export class DualWriteKnowledgeGraph implements KnowledgeGraph {
  private jsonGraph: SimpleKnowledgeGraph;
  private kuzuGraph: KuzuKnowledgeGraph | null;
  private enableKuzuDB: boolean;
  private dualWriteStats: {
    nodesWrittenToJSON: number;
    nodesWrittenToKuzuDB: number;
    relationshipsWrittenToJSON: number;
    relationshipsWrittenToKuzuDB: number;
    kuzuErrors: number;
  };

  constructor(kuzuGraph?: KuzuKnowledgeGraph) {
    this.jsonGraph = new SimpleKnowledgeGraph();
    this.kuzuGraph = kuzuGraph || null;
    this.enableKuzuDB = !!kuzuGraph;
    this.dualWriteStats = {
      nodesWrittenToJSON: 0,
      nodesWrittenToKuzuDB: 0,
      relationshipsWrittenToJSON: 0,
      relationshipsWrittenToKuzuDB: 0,
      kuzuErrors: 0
    };
  }

  /**
   * Get all nodes in the graph (from JSON primary storage)
   */
  get nodes(): GraphNode[] {
    return this.jsonGraph.nodes;
  }

  /**
   * Get all relationships in the graph (from JSON primary storage)
   */
  get relationships(): GraphRelationship[] {
    return this.jsonGraph.relationships;
  }

  /**
   * Add node - transparent dual-write
   * Maintains exact same synchronous interface as original
   */
  addNode(node: GraphNode): void {
    // Always write to JSON first (primary storage)
    this.jsonGraph.addNode(node);
    this.dualWriteStats.nodesWrittenToJSON++;

    // Write to KuzuDB in background if enabled
    if (this.enableKuzuDB && this.kuzuGraph) {
      try {
        // KuzuDB addNode is synchronous (batched)
        this.kuzuGraph.addNode(node);
        this.dualWriteStats.nodesWrittenToKuzuDB++;
      } catch (error) {
        this.dualWriteStats.kuzuErrors++;
        console.warn(`❌ KuzuDB node write failed for ${node.id} (${node.label}):`, error);
        // Continue - JSON is primary, KuzuDB failure shouldn't break the process
      }
    }
  }

  /**
   * Add relationship - transparent dual-write  
   * Maintains exact same synchronous interface as original
   */
  addRelationship(relationship: GraphRelationship): void {
    // Always write to JSON first (primary storage)
    this.jsonGraph.addRelationship(relationship);
    this.dualWriteStats.relationshipsWrittenToJSON++;

    // Write to KuzuDB in background if enabled
    if (this.enableKuzuDB && this.kuzuGraph) {
      try {
        // KuzuDB addRelationship is synchronous (batched)
        this.kuzuGraph.addRelationship(relationship);
        this.dualWriteStats.relationshipsWrittenToKuzuDB++;
      } catch (error) {
        this.dualWriteStats.kuzuErrors++;
        console.warn(`❌ KuzuDB relationship write failed for ${relationship.id} (${relationship.type}):`, error);
        // Continue - JSON is primary, KuzuDB failure shouldn't break the process
      }
    }
  }

  /**
   * Get KuzuDB instance for advanced operations (optional)
   */
  getKuzuGraph(): KuzuKnowledgeGraph | null {
    return this.kuzuGraph;
  }

  /**
   * Check if KuzuDB is enabled and available
   */
  isKuzuDBEnabled(): boolean {
    return this.enableKuzuDB && this.kuzuGraph !== null;
  }

  /**
   * Get dual-write statistics
   */
  getDualWriteStats() {
    return { ...this.dualWriteStats };
  }

  /**
   * Log dual-write statistics
   */
  logDualWriteStats(): void {
    console.log('📊 Dual-Write Statistics:');
    console.log(`  JSON nodes written: ${this.dualWriteStats.nodesWrittenToJSON}`);
    console.log(`  JSON relationships written: ${this.dualWriteStats.relationshipsWrittenToJSON}`);
    console.log(`  Total JSON entities: ${this.dualWriteStats.nodesWrittenToJSON + this.dualWriteStats.relationshipsWrittenToJSON}`);
    
    // Compare with actual graph counts
    const actualNodes = this.jsonGraph.nodes.length;
    const actualRels = this.jsonGraph.relationships.length;
    console.log(`  Actual JSON graph: ${actualNodes} nodes, ${actualRels} relationships`);
    
    if (actualNodes !== this.dualWriteStats.nodesWrittenToJSON) {
      console.warn(`  ⚠️ Mismatch: Expected ${this.dualWriteStats.nodesWrittenToJSON} nodes, but graph has ${actualNodes}`);
    }
    if (actualRels !== this.dualWriteStats.relationshipsWrittenToJSON) {
      console.warn(`  ⚠️ Mismatch: Expected ${this.dualWriteStats.relationshipsWrittenToJSON} relationships, but graph has ${actualRels}`);
    }
    
    if (this.enableKuzuDB) {
      console.log(`  KuzuDB nodes written: ${this.dualWriteStats.nodesWrittenToKuzuDB}`);
      console.log(`  KuzuDB relationships written: ${this.dualWriteStats.relationshipsWrittenToKuzuDB}`);
      console.log(`  KuzuDB errors: ${this.dualWriteStats.kuzuErrors}`);
      
      const totalWrites = this.dualWriteStats.nodesWrittenToJSON + this.dualWriteStats.relationshipsWrittenToJSON;
      const kuzuWrites = this.dualWriteStats.nodesWrittenToKuzuDB + this.dualWriteStats.relationshipsWrittenToKuzuDB;
      const successRate = totalWrites > 0 ? (kuzuWrites / totalWrites * 100).toFixed(1) : '0';
      console.log(`  KuzuDB success rate: ${successRate}%`);
      
      if (this.dualWriteStats.kuzuErrors > 0) {
        console.log(`  ⚠️ ${this.dualWriteStats.kuzuErrors} KuzuDB write failures detected - check logs above for details`);
      }
    } else {
      console.log('  KuzuDB: Disabled');
    }
  }

  /**
   * Flush any pending KuzuDB operations (for cleanup)
   */
  async flushKuzuDB(): Promise<void> {
    if (this.enableKuzuDB && this.kuzuGraph) {
      try {
        await this.kuzuGraph.commitAll();
        console.log('✅ KuzuDB operations flushed successfully');
      } catch (error) {
        console.error('❌ Failed to flush KuzuDB operations:', error);
        this.dualWriteStats.kuzuErrors++;
      }
    }
  }
}

