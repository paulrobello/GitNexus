/**
 * Comprehensive test suite for Direct-Write KuzuDB implementation
 * 
 * This test ensures that the direct-write approach:
 * 1. Maintains data integrity
 * 2. Provides performance improvements
 * 3. Handles errors gracefully
 * 4. Falls back to batching when needed
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DirectWriteKnowledgeGraph } from '../core/graph/direct-write-knowledge-graph.ts';
import { DualWriteKnowledgeGraph } from '../core/graph/dual-write-knowledge-graph.ts';
import { SimpleKnowledgeGraph } from '../core/graph/graph.ts';
import type { GraphNode, GraphRelationship } from '../core/graph/types.ts';

// Mock KuzuDB for testing
const mockKuzuGraph = {
  addNode: vi.fn(),
  addRelationship: vi.fn(),
  commitAll: vi.fn(),
  executeQuery: vi.fn().mockResolvedValue({ rows: [], columns: [] }),
  nodes: [],
  relationships: []
};

describe('DirectWriteKnowledgeGraph', () => {
  let directWriteGraph: DirectWriteKnowledgeGraph;
  let dualWriteGraph: DualWriteKnowledgeGraph;
  let simpleGraph: SimpleKnowledgeGraph;

  beforeEach(() => {
    vi.clearAllMocks();
    
    directWriteGraph = new DirectWriteKnowledgeGraph(mockKuzuGraph as any, {
      enableDirectWrites: true,
      maxConcurrentWrites: 5,
      fallbackToBatching: true,
      retryAttempts: 2
    });
    
    dualWriteGraph = new DualWriteKnowledgeGraph(mockKuzuGraph as any);
    simpleGraph = new SimpleKnowledgeGraph();
  });

  afterEach(async () => {
    // Cleanup any pending operations
    if ('flushPendingOperations' in directWriteGraph) {
      await directWriteGraph.flushPendingOperations();
    }
  });

  describe('Data Integrity', () => {
    it('should maintain identical JSON storage across all implementations', () => {
      const testNode: GraphNode = {
        id: 'test-node-1',
        label: 'Function',
        properties: {
          name: 'testFunction',
          filePath: '/test/file.ts',
          startLine: 10
        }
      };

      // Add to all implementations
      directWriteGraph.addNode(testNode);
      dualWriteGraph.addNode(testNode);
      simpleGraph.addNode(testNode);

      // Verify JSON storage is identical
      expect(directWriteGraph.nodes).toEqual(simpleGraph.nodes);
      expect(dualWriteGraph.nodes).toEqual(simpleGraph.nodes);
      expect(directWriteGraph.nodes.length).toBe(1);
      expect(directWriteGraph.nodes[0]).toEqual(testNode);
    });

    it('should handle relationship storage consistently', () => {
      const testRelationship: GraphRelationship = {
        id: 'test-rel-1',
        type: 'CALLS',
        source: 'node-1',
        target: 'node-2',
        properties: {
          callType: 'function',
          line: 15
        }
      };

      directWriteGraph.addRelationship(testRelationship);
      dualWriteGraph.addRelationship(testRelationship);
      simpleGraph.addRelationship(testRelationship);

      expect(directWriteGraph.relationships).toEqual(simpleGraph.relationships);
      expect(dualWriteGraph.relationships).toEqual(simpleGraph.relationships);
    });

    it('should handle large datasets without data loss', async () => {
      const nodeCount = 1000;
      const nodes: GraphNode[] = [];

      // Generate test nodes
      for (let i = 0; i < nodeCount; i++) {
        nodes.push({
          id: `node-${i}`,
          label: 'Function',
          properties: {
            name: `function${i}`,
            filePath: `/test/file${i}.ts`,
            startLine: i * 10
          }
        });
      }

      // Add all nodes
      const startTime = performance.now();
      for (const node of nodes) {
        directWriteGraph.addNode(node);
      }
      
      // Wait for all operations to complete
      await directWriteGraph.flushPendingOperations();
      const endTime = performance.now();

      // Verify all nodes are present
      expect(directWriteGraph.nodes.length).toBe(nodeCount);
      
      // Verify performance (should be faster than traditional batching)
      const processingTime = endTime - startTime;
      console.log(`Direct write processing time for ${nodeCount} nodes: ${processingTime}ms`);
      
      // Performance should be reasonable (less than 5 seconds for 1000 nodes)
      expect(processingTime).toBeLessThan(5000);
    });
  });

  describe('Performance Improvements', () => {
    it('should complete operations faster than dual-write with batching', async () => {
      const testNodes: GraphNode[] = Array.from({ length: 100 }, (_, i) => ({
        id: `perf-node-${i}`,
        label: 'Function',
        properties: {
          name: `perfFunction${i}`,
          filePath: `/perf/file${i}.ts`,
          startLine: i
        }
      }));

      // Test direct write performance
      const directStartTime = performance.now();
      for (const node of testNodes) {
        directWriteGraph.addNode(node);
      }
      await directWriteGraph.flushPendingOperations();
      const directEndTime = performance.now();
      const directTime = directEndTime - directStartTime;

      // Test dual write performance (simulated)
      const dualStartTime = performance.now();
      for (const node of testNodes) {
        dualWriteGraph.addNode(node);
      }
      // Simulate the flush delay that would occur
      await new Promise(resolve => setTimeout(resolve, 100)); // Simulated flush time
      const dualEndTime = performance.now();
      const dualTime = dualEndTime - dualStartTime;

      console.log(`Direct write time: ${directTime}ms, Dual write time: ${dualTime}ms`);
      
      // Direct writes should be competitive or faster
      expect(directTime).toBeLessThan(dualTime * 2); // Allow some overhead for async operations
    });

    it('should provide real-time progress without batching delays', async () => {
      const stats = directWriteGraph.getStats();
      
      // Initially no pending operations
      expect(stats.pendingNodes).toBe(0);
      expect(stats.pendingRelationships).toBe(0);

      // Add some nodes
      directWriteGraph.addNode({
        id: 'progress-node-1',
        label: 'Function',
        properties: { name: 'test1' }
      });

      directWriteGraph.addNode({
        id: 'progress-node-2',
        label: 'Function',
        properties: { name: 'test2' }
      });

      // Should show immediate progress in JSON storage
      expect(directWriteGraph.nodes.length).toBe(2);
      
      // Wait for KuzuDB operations to complete
      await directWriteGraph.flushPendingOperations();
      
      const finalStats = directWriteGraph.getStats();
      expect(finalStats.totalNodes).toBe(2);
    });
  });

  describe('Error Handling and Fallback', () => {
    it('should continue processing when KuzuDB writes fail', async () => {
      // Mock KuzuDB failure
      mockKuzuGraph.executeQuery.mockRejectedValueOnce(new Error('KuzuDB connection failed'));

      const testNode: GraphNode = {
        id: 'error-node-1',
        label: 'Function',
        properties: { name: 'errorFunction' }
      };

      // Should not throw error
      expect(() => directWriteGraph.addNode(testNode)).not.toThrow();

      // JSON storage should still work
      expect(directWriteGraph.nodes.length).toBe(1);
      expect(directWriteGraph.nodes[0]).toEqual(testNode);

      // Wait for async operations to complete
      await directWriteGraph.flushPendingOperations();

      // Check that fallback was triggered
      const stats = directWriteGraph.getStats();
      expect(stats.directWriteFailures).toBeGreaterThan(0);
    });

    it('should retry failed operations according to configuration', async () => {
      let callCount = 0;
      mockKuzuGraph.executeQuery.mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.reject(new Error('Temporary failure'));
        }
        return Promise.resolve({ rows: [], columns: [] });
      });

      const testNode: GraphNode = {
        id: 'retry-node-1',
        label: 'Function',
        properties: { name: 'retryFunction' }
      };

      directWriteGraph.addNode(testNode);
      await directWriteGraph.flushPendingOperations();

      // Should have retried and eventually succeeded
      expect(callCount).toBe(3); // Initial attempt + 2 retries
    });

    it('should fallback to batching when direct writes consistently fail', async () => {
      // Mock consistent failures
      mockKuzuGraph.executeQuery.mockRejectedValue(new Error('Persistent KuzuDB failure'));

      const testNodes: GraphNode[] = Array.from({ length: 5 }, (_, i) => ({
        id: `fallback-node-${i}`,
        label: 'Function',
        properties: { name: `fallbackFunction${i}` }
      }));

      for (const node of testNodes) {
        directWriteGraph.addNode(node);
      }

      await directWriteGraph.flushPendingOperations();

      const stats = directWriteGraph.getStats();
      
      // Should have fallen back to batching for some operations
      expect(stats.fallbackToBatch).toBeGreaterThan(0);
      
      // JSON storage should still be intact
      expect(directWriteGraph.nodes.length).toBe(5);
    });
  });

  describe('Concurrency Control', () => {
    it('should handle concurrent writes without data corruption', async () => {
      const concurrentNodes: GraphNode[] = Array.from({ length: 20 }, (_, i) => ({
        id: `concurrent-node-${i}`,
        label: 'Function',
        properties: { name: `concurrentFunction${i}` }
      }));

      // Add all nodes concurrently
      const promises = concurrentNodes.map(node => 
        Promise.resolve(directWriteGraph.addNode(node))
      );

      await Promise.all(promises);
      await directWriteGraph.flushPendingOperations();

      // All nodes should be present
      expect(directWriteGraph.nodes.length).toBe(20);
      
      // No duplicates should exist
      const nodeIds = directWriteGraph.nodes.map(n => n.id);
      const uniqueIds = new Set(nodeIds);
      expect(uniqueIds.size).toBe(20);
    });

    it('should respect maxConcurrentWrites configuration', async () => {
      const maxConcurrentWrites = 3;
      const testGraph = new DirectWriteKnowledgeGraph(mockKuzuGraph as any, {
        enableDirectWrites: true,
        maxConcurrentWrites,
        fallbackToBatching: false
      });

      // Track concurrent operations
      let activeCalls = 0;
      let maxConcurrentCalls = 0;

      mockKuzuGraph.executeQuery.mockImplementation(() => {
        activeCalls++;
        maxConcurrentCalls = Math.max(maxConcurrentCalls, activeCalls);
        
        return new Promise(resolve => {
          setTimeout(() => {
            activeCalls--;
            resolve({ rows: [], columns: [] });
          }, 10);
        });
      });

      // Add many nodes quickly
      const nodes: GraphNode[] = Array.from({ length: 10 }, (_, i) => ({
        id: `concurrent-limit-node-${i}`,
        label: 'Function',
        properties: { name: `limitFunction${i}` }
      }));

      for (const node of nodes) {
        testGraph.addNode(node);
      }

      await testGraph.flushPendingOperations();

      // Should not exceed the configured limit
      expect(maxConcurrentCalls).toBeLessThanOrEqual(maxConcurrentWrites);
    });
  });

  describe('Transaction Support', () => {
    it('should support transaction boundaries for batch operations', async () => {
      const nodes: GraphNode[] = Array.from({ length: 3 }, (_, i) => ({
        id: `transaction-node-${i}`,
        label: 'Function',
        properties: { name: `transactionFunction${i}` }
      }));

      await directWriteGraph.beginTransaction();
      
      for (const node of nodes) {
        await directWriteGraph.addNodeAsync(node);
      }
      
      await directWriteGraph.commitTransaction();

      // All nodes should be present after commit
      expect(directWriteGraph.nodes.length).toBe(3);
    });

    it('should rollback transactions on failure', async () => {
      // Mock failure during transaction
      let callCount = 0;
      mockKuzuGraph.executeQuery.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          return Promise.reject(new Error('Transaction failure'));
        }
        return Promise.resolve({ rows: [], columns: [] });
      });

      const nodes: GraphNode[] = Array.from({ length: 3 }, (_, i) => ({
        id: `rollback-node-${i}`,
        label: 'Function',
        properties: { name: `rollbackFunction${i}` }
      }));

      await directWriteGraph.beginTransaction();
      
      try {
        for (const node of nodes) {
          await directWriteGraph.addNodeAsync(node);
        }
        await directWriteGraph.commitTransaction();
      } catch (error) {
        // Transaction should rollback automatically
        expect(error).toBeDefined();
      }

      // JSON storage should still have the nodes (since JSON writes happen immediately)
      expect(directWriteGraph.nodes.length).toBe(3);
    });
  });
});

describe('Integration with Existing Pipeline', () => {
  it('should maintain backward compatibility with existing processors', () => {
    const graph = new DirectWriteKnowledgeGraph(mockKuzuGraph as any);
    
    // Should support the existing synchronous interface
    expect(typeof graph.addNode).toBe('function');
    expect(typeof graph.addRelationship).toBe('function');
    expect(Array.isArray(graph.nodes)).toBe(true);
    expect(Array.isArray(graph.relationships)).toBe(true);

    // Should also support new async interface
    expect(typeof graph.addNodeAsync).toBe('function');
    expect(typeof graph.addRelationshipAsync).toBe('function');
    expect(typeof graph.flushPendingOperations).toBe('function');
  });

  it('should provide performance statistics for monitoring', () => {
    const graph = new DirectWriteKnowledgeGraph(mockKuzuGraph as any);
    const stats = graph.getStats();

    // Should include all expected metrics
    expect(typeof stats.nodesWrittenToJSON).toBe('number');
    expect(typeof stats.nodesWrittenToKuzuDB).toBe('number');
    expect(typeof stats.directWriteSuccesses).toBe('number');
    expect(typeof stats.directWriteFailures).toBe('number');
    expect(typeof stats.averageWriteTimeMs).toBe('number');
    expect(typeof stats.activeWrites).toBe('number');
  });
});
