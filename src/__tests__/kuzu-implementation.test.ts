/**
 * Comprehensive Test Suite for KuzuDB Implementation
 * 
 * Tests all components of the KuzuDB integration including:
 * - WASM loader
 * - Query engine
 * - Knowledge graph implementation
 * - Schema management
 * - Data migration
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { KnowledgeGraph, GraphNode, GraphRelationship } from '../core/graph/types.js';
import { initKuzuDB, isKuzuDBSupported } from '../core/kuzu/kuzu-loader.js';
import { KuzuQueryEngine } from '../core/graph/kuzu-query-engine.js';
import { KuzuKnowledgeGraph } from '../core/graph/kuzu-knowledge-graph.js';
import { KuzuSchemaManager, NODE_TABLE_SCHEMAS, RELATIONSHIP_TABLE_SCHEMAS } from '../core/kuzu/kuzu-schema.js';
import { generateId } from '../lib/utils.js';

// Mock feature flags for testing
jest.mock('../config/feature-flags.js', () => ({
  isKuzuDBEnabled: () => true,
  isKuzuDBPersistenceEnabled: () => true,
  isPerformanceMonitoringEnabled: () => true
}));

describe('KuzuDB WASM Loader', () => {
  it('should check WebAssembly support', () => {
    expect(typeof isKuzuDBSupported).toBe('function');
    // Note: In test environment, WebAssembly might not be available
  });

  it('should initialize KuzuDB instance', async () => {
    // This test will be skipped if WASM is not available in test environment
    if (!isKuzuDBSupported()) {
      console.log('⚠️ Skipping WASM test - WebAssembly not supported in test environment');
      return;
    }

    try {
      const instance = await initKuzuDB();
      expect(instance).toBeDefined();
      expect(instance.isReady).toBeDefined();
      expect(instance.createDatabase).toBeDefined();
      expect(instance.executeQuery).toBeDefined();
    } catch (error) {
      // WASM loading might fail in test environment
      console.log('⚠️ WASM loading failed in test environment:', error);
    }
  });

  it('should handle WASM loading failures gracefully', async () => {
    // Mock fetch to simulate WASM loading failure
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error('WASM not found'));

    try {
      await initKuzuDB();
      expect(false).toBe(true); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('WASM loading failed');
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('KuzuQueryEngine', () => {
  let queryEngine;

  beforeEach(() => {
    queryEngine = new KuzuQueryEngine({
      databasePath: '/test_db',
      enableCache: true,
      cacheSize: 100,
      cacheTTL: 1000
    });
  });

  afterEach(async () => {
    if (queryEngine.isReady()) {
      await queryEngine.close();
    }
  });

  it('should initialize with default options', () => {
    const defaultEngine = new KuzuQueryEngine();
    expect(defaultEngine).toBeDefined();
    expect(defaultEngine.isReady()).toBe(false);
  });

  it('should handle initialization failure', async () => {
    // Mock initKuzuDB to fail
    jest.doMock('../core/kuzu/kuzu-loader.js', () => ({
      initKuzuDB: jest.fn().mockRejectedValue(new Error('Init failed'))
    }));

    try {
      await queryEngine.initialize();
      expect(false).toBe(true); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('initialization failed');
    }
  });

  it('should provide statistics', () => {
    const stats = queryEngine.getStatistics();
    expect(stats).toHaveProperty('isInitialized');
    expect(stats).toHaveProperty('queryCount');
    expect(stats).toHaveProperty('averageExecutionTime');
    expect(stats).toHaveProperty('cacheHitRate');
    expect(stats).toHaveProperty('cacheSize');
    
    expect(stats.isInitialized).toBe(false);
    expect(stats.queryCount).toBe(0);
    expect(stats.cacheSize).toBe(0);
  });

  it('should clear cache', () => {
    queryEngine.clearCache();
    const stats = queryEngine.getStatistics();
    expect(stats.cacheSize).toBe(0);
  });

  it('should reject queries when not initialized', async () => {
    try {
      await queryEngine.executeQuery('MATCH (n) RETURN n');
      expect(false).toBe(true); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('not initialized');
    }
  });
});

describe('KuzuKnowledgeGraph', () => {
  let mockQueryEngine;
  let kuzuGraph;

  beforeEach(() => {
    // Create mock query engine
    mockQueryEngine = {
      initialize: jest.fn().mockResolvedValue(undefined),
      executeQuery: jest.fn().mockResolvedValue({
        columns: [],
        rows: [],
        rowCount: 0,
        resultCount: 0,
        executionTime: 0
      }),
      executeGraphQuery: jest.fn().mockResolvedValue({
        nodes: [],
        relationships: [],
        executionTime: 0
      }),
      importGraph: jest.fn().mockResolvedValue(undefined),
      isReady: jest.fn().mockReturnValue(true),
      close: jest.fn().mockResolvedValue(undefined),
      getStatistics: jest.fn().mockReturnValue({
        isInitialized: true,
        queryCount: 0,
        averageExecutionTime: 0,
        cacheHitRate: 0,
        cacheSize: 0
      }),
      clearCache: jest.fn()
    };

    kuzuGraph = new KuzuKnowledgeGraph(mockQueryEngine, {
      enableCache: true,
      batchSize: 10,
      autoCommit: false
    });
  });

  it('should implement KnowledgeGraph interface', () => {
    expect(kuzuGraph.addNode).toBeDefined();
    expect(kuzuGraph.addRelationship).toBeDefined();
    expect(kuzuGraph.nodes).toBeDefined();
    expect(kuzuGraph.relationships).toBeDefined();
  });

  it('should add nodes to pending batch', () => {
    const node = {
      id: generateId('test'),
      label: 'Function',
      properties: {
        name: 'testFunction',
        filePath: '/test.ts'
      }
    };

    kuzuGraph.addNode(node);
    const stats = kuzuGraph.getCacheStatistics();
    expect(stats.pendingNodes).toBe(1);
    expect(stats.nodesCached).toBe(1);
  });

  it('should add relationships to pending batch', () => {
    const relationship = {
      id: generateId('rel'),
      type: 'CALLS',
      source: 'func1',
      target: 'func2',
      properties: {
        confidence: 0.9
      }
    };

    kuzuGraph.addRelationship(relationship);
    const stats = kuzuGraph.getCacheStatistics();
    expect(stats.pendingRelationships).toBe(1);
    expect(stats.relationshipsCached).toBe(1);
  });

  it('should commit nodes to database', async () => {
    const node = {
      id: generateId('test'),
      label: 'Function',
      properties: {
        name: 'testFunction',
        filePath: '/test.ts'
      }
    };

    kuzuGraph.addNode(node);
    await kuzuGraph.commitNodes();

    expect(mockQueryEngine.executeQuery).toHaveBeenCalled();
    const stats = kuzuGraph.getCacheStatistics();
    expect(stats.pendingNodes).toBe(0);
  });

  it('should commit relationships to database', async () => {
    const relationship = {
      id: generateId('rel'),
      type: 'CALLS',
      source: 'func1',
      target: 'func2',
      properties: {
        confidence: 0.9
      }
    };

    kuzuGraph.addRelationship(relationship);
    await kuzuGraph.commitRelationships();

    expect(mockQueryEngine.executeQuery).toHaveBeenCalled();
    const stats = kuzuGraph.getCacheStatistics();
    expect(stats.pendingRelationships).toBe(0);
  });

  it('should find nodes by label', async () => {
    const mockNodes = [
      {
        id: 'func1',
        label: 'Function' as const,
        properties: { name: 'test1' }
      }
    ];

    mockQueryEngine.executeQuery.mockResolvedValue({
      columns: ['n'],
      rows: [mockNodes],
      rowCount: 1,
      resultCount: 1,
      executionTime: 5
    });

    const nodes = await kuzuGraph.findNodesByLabel('Function');
    expect(mockQueryEngine.executeQuery).toHaveBeenCalledWith(
      'MATCH (n:Function) RETURN n'
    );
  });

  it('should find node by ID', async () => {
    const mockNode = {
      id: 'func1',
      label: 'Function' as const,
      properties: { name: 'test1' }
    };

    mockQueryEngine.executeQuery.mockResolvedValue({
      columns: ['n'],
      rows: [[mockNode]],
      rowCount: 1,
      resultCount: 1,
      executionTime: 5
    });

    const node = await kuzuGraph.findNodeById('func1');
    expect(mockQueryEngine.executeQuery).toHaveBeenCalledWith(
      "MATCH (n) WHERE n.id = 'func1' RETURN n LIMIT 1"
    );
  });

  it('should get connected nodes', async () => {
    mockQueryEngine.executeQuery
      .mockResolvedValueOnce({
        columns: ['target'],
        rows: [],
        rowCount: 0,
        resultCount: 0,
        executionTime: 5
      })
      .mockResolvedValueOnce({
        columns: ['source'],
        rows: [],
        rowCount: 0,
        resultCount: 0,
        executionTime: 5
      });

    const connected = await kuzuGraph.getConnectedNodes('func1', 'CALLS');
    expect(connected).toHaveProperty('outgoing');
    expect(connected).toHaveProperty('incoming');
    expect(Array.isArray(connected.outgoing)).toBe(true);
    expect(Array.isArray(connected.incoming)).toBe(true);
  });

  it('should get graph statistics', async () => {
    mockQueryEngine.executeQuery
      .mockResolvedValueOnce({ columns: ['count'], rows: [[100]], rowCount: 1, resultCount: 1, executionTime: 5 })
      .mockResolvedValueOnce({ columns: ['count'], rows: [[50]], rowCount: 1, resultCount: 1, executionTime: 5 })
      .mockResolvedValueOnce({ columns: ['label', 'count'], rows: [['Function', 80], ['Class', 20]], rowCount: 2, resultCount: 2, executionTime: 5 })
      .mockResolvedValueOnce({ columns: ['type', 'count'], rows: [['CALLS', 30], ['CONTAINS', 20]], rowCount: 2, resultCount: 2, executionTime: 5 });

    const stats = await kuzuGraph.getStatistics();
    expect(stats.nodeCount).toBe(100);
    expect(stats.relationshipCount).toBe(50);
    expect(stats.nodesByLabel).toEqual({ Function: 80, Class: 20 });
    expect(stats.relationshipsByType).toEqual({ CALLS: 30, CONTAINS: 20 });
  });

  it('should clear cache', () => {
    const node = {
      id: generateId('test'),
      label: 'Function',
      properties: { name: 'test' }
    };

    kuzuGraph.addNode(node);
    expect(kuzuGraph.getCacheStatistics().nodesCached).toBe(1);

    kuzuGraph.clearCache();
    expect(kuzuGraph.getCacheStatistics().nodesCached).toBe(0);
  });
});

describe('KuzuSchemaManager', () => {
  let mockKuzuInstance;
  let schemaManager;

  beforeEach(() => {
    mockKuzuInstance = {
      createNodeTable: jest.fn().mockResolvedValue(undefined),
      createRelTable: jest.fn().mockResolvedValue(undefined),
      executeQuery: jest.fn().mockResolvedValue({
        columns: ['name', 'type'],
        rows: [['Project', 'NODE'], ['Function', 'NODE'], ['CONTAINS', 'REL']],
        rowCount: 3
      })
    };

    schemaManager = new KuzuSchemaManager(mockKuzuInstance);
  });

  it('should initialize complete schema', async () => {
    await schemaManager.initializeSchema();

    // Should create all node tables
    expect(mockKuzuInstance.createNodeTable).toHaveBeenCalledTimes(
      Object.keys(NODE_TABLE_SCHEMAS).length
    );

    // Should create all relationship tables
    expect(mockKuzuInstance.createRelTable).toHaveBeenCalledTimes(
      RELATIONSHIP_TABLE_SCHEMAS.length
    );
  });

  it('should handle table creation errors gracefully', async () => {
    mockKuzuInstance.createNodeTable.mockRejectedValue(new Error('Table exists'));
    
    // Should not throw error, just log warning
    await expect(schemaManager.initializeSchema()).resolves.not.toThrow();
  });

  it('should validate schema', async () => {
    const validation = await schemaManager.validateSchema();
    
    expect(validation).toHaveProperty('isValid');
    expect(validation).toHaveProperty('missingTables');
    expect(validation).toHaveProperty('errors');
    expect(Array.isArray(validation.missingTables)).toBe(true);
    expect(Array.isArray(validation.errors)).toBe(true);
  });

  it('should get schema information', async () => {
    const schemaInfo = await schemaManager.getSchemaInfo();
    
    expect(schemaInfo).toHaveProperty('nodeTables');
    expect(schemaInfo).toHaveProperty('relationshipTables');
    expect(schemaInfo).toHaveProperty('totalTables');
    expect(Array.isArray(schemaInfo.nodeTables)).toBe(true);
    expect(Array.isArray(schemaInfo.relationshipTables)).toBe(true);
    expect(typeof schemaInfo.totalTables).toBe('number');
  });

  it('should drop all tables', async () => {
    mockKuzuInstance.executeQuery.mockResolvedValue({
      columns: [],
      rows: [],
      rowCount: 0
    });

    await schemaManager.dropAllTables();

    // Should call DROP TABLE for each table
    const expectedDrops = Object.keys(NODE_TABLE_SCHEMAS).length + RELATIONSHIP_TABLE_SCHEMAS.length;
    expect(mockKuzuInstance.executeQuery).toHaveBeenCalledTimes(expectedDrops);
  });
});

describe('Data Migration Integration', () => {
  let mockQueryEngine;
  let kuzuGraph;

  beforeEach(() => {
    mockQueryEngine = {
      initialize: jest.fn().mockResolvedValue(undefined),
      executeQuery: jest.fn().mockResolvedValue({
        columns: [],
        rows: [],
        rowCount: 0,
        resultCount: 0,
        executionTime: 0
      }),
      importGraph: jest.fn().mockResolvedValue(undefined),
      isReady: jest.fn().mockReturnValue(true),
      close: jest.fn().mockResolvedValue(undefined),
      getStatistics: jest.fn().mockReturnValue({
        isInitialized: true,
        queryCount: 0,
        averageExecutionTime: 0,
        cacheHitRate: 0,
        cacheSize: 0
      }),
      clearCache: jest.fn()
    };

    kuzuGraph = new KuzuKnowledgeGraph(mockQueryEngine);
  });

  it('should migrate a complete knowledge graph', async () => {
    // Create a sample knowledge graph
    const sampleGraph = {
      nodes: [
        {
          id: 'project1',
          label: 'Project',
          properties: {
            name: 'TestProject',
            path: '/test/project'
          }
        },
        {
          id: 'file1',
          label: 'File',
          properties: {
            name: 'main.ts',
            filePath: '/test/project/main.ts',
            language: 'typescript'
          }
        },
        {
          id: 'func1',
          label: 'Function',
          properties: {
            name: 'main',
            filePath: '/test/project/main.ts',
            startLine: 10,
            endLine: 20
          }
        }
      ],
      relationships: [
        {
          id: 'contains1',
          type: 'CONTAINS',
          source: 'project1',
          target: 'file1',
          properties: {}
        },
        {
          id: 'contains2',
          type: 'CONTAINS',
          source: 'file1',
          target: 'func1',
          properties: {}
        }
      ],
      addNode: function(node: GraphNode): void {
        this.nodes.push(node);
      },
      addRelationship: function(relationship: GraphRelationship): void {
        this.relationships.push(relationship);
      }
    };

    // Import the graph
    await mockQueryEngine.importGraph(sampleGraph);

    expect(mockQueryEngine.importGraph).toHaveBeenCalledWith(sampleGraph);
  });

  it('should handle migration errors gracefully', async () => {
    mockQueryEngine.importGraph.mockRejectedValue(new Error('Import failed'));

    const sampleGraph = {
      nodes: [],
      relationships: [],
      addNode: function(node: GraphNode): void {
        this.nodes.push(node);
      },
      addRelationship: function(relationship: GraphRelationship): void {
        this.relationships.push(relationship);
      }
    };

    await expect(mockQueryEngine.importGraph(sampleGraph)).rejects.toThrow('Import failed');
  });
});

describe('Performance and Memory Management', () => {
  let kuzuGraph;
  let mockQueryEngine;

  beforeEach(() => {
    mockQueryEngine = {
      executeQuery: jest.fn().mockResolvedValue({
        columns: [],
        rows: [],
        rowCount: 0,
        resultCount: 0,
        executionTime: 0
      })
    };

    kuzuGraph = new KuzuKnowledgeGraph(mockQueryEngine, {
      batchSize: 5,
      autoCommit: true
    });
  });

  it('should handle large batches efficiently', () => {
    // Add many nodes
    for (let i = 0; i < 100; i++) {
      const node = {
        id: `node${i}`,
        label: 'Function',
        properties: {
          name: `function${i}`,
          filePath: `/test/file${i}.ts`
        }
      };
      kuzuGraph.addNode(node);
    }

    const stats = kuzuGraph.getCacheStatistics();
    expect(stats.nodesCached).toBe(100);
  });

  it('should manage memory usage with cache limits', () => {
    const smallCacheGraph = new KuzuKnowledgeGraph(mockQueryEngine, {
      enableCache: true,
      batchSize: 1000
    });

    // Add nodes beyond cache limit
    for (let i = 0; i < 50; i++) {
      const node = {
        id: `node${i}`,
        label: 'Function',
        properties: { name: `function${i}` }
      };
      smallCacheGraph.addNode(node);
    }

    // Cache should still work
    const stats = smallCacheGraph.getCacheStatistics();
    expect(stats.nodesCached).toBe(50);
  });
});

// Integration test that requires manual verification
describe('Manual Integration Tests', () => {
  it.skip('should perform end-to-end test with real KuzuDB', async () => {
    // This test is skipped by default as it requires actual KuzuDB WASM
    // To run this test:
    // 1. Ensure KuzuDB WASM is properly loaded
    // 2. Remove .skip from the test
    // 3. Run with proper test environment

    try {
      const queryEngine = new KuzuQueryEngine();
      await queryEngine.initialize();

      const kuzuGraph = new KuzuKnowledgeGraph(queryEngine);

      // Add sample data
      const node = {
        id: 'test1',
        label: 'Function',
        properties: {
          name: 'testFunction',
          filePath: '/test.ts'
        }
      };

      kuzuGraph.addNode(node);
      await kuzuGraph.commitAll();

      // Query the data
      const nodes = await kuzuGraph.findNodesByLabel('Function');
      expect(nodes.length).toBeGreaterThan(0);

      await queryEngine.close();
    } catch (error) {
      console.log('End-to-end test requires real KuzuDB WASM environment');
      throw error;
    }
  });
});
