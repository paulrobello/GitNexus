/**
 * KuzuDB Query Engine
 * 
 * This module provides a high-level interface for executing queries
 * against KuzuDB, with support for graph data import, query optimization,
 * and performance monitoring.
 */

import type { KnowledgeGraph, GraphNode, GraphRelationship } from './types.ts';
import type { KuzuInstance, QueryResult } from '../kuzu/kuzu-loader.ts';
import { initKuzuDB } from '../kuzu/kuzu-loader.ts';
import { isKuzuDBEnabled, isKuzuDBPersistenceEnabled } from '../../config/feature-flags.ts';

export interface QueryOptions {
  timeout?: number;
  maxResults?: number;
  includeExecutionTime?: boolean;
  useCache?: boolean;
}

export interface KuzuQueryResult extends QueryResult {
  nodes?: GraphNode[];
  relationships?: GraphRelationship[];
  resultCount: number;
  executionTime: number;
  fromCache?: boolean;
}

export interface QueryCache {
  [queryHash: string]: {
    result: KuzuQueryResult;
    timestamp: number;
    hitCount: number;
  };
}

export interface KuzuQueryEngineOptions {
  databasePath?: string;
  enableCache?: boolean;
  cacheSize?: number;
  cacheTTL?: number; // Time to live in milliseconds
}

/**
 * High-level query engine for KuzuDB operations
 */
export class KuzuQueryEngine {
  private kuzuInstance: KuzuInstance | null = null;
  private isInitialized: boolean = false;
  private databasePath: string = '/gitnexus_db';
  private queryCache: QueryCache = {};
  private cacheEnabled: boolean = true;
  private maxCacheSize: number = 1000;
  private cacheTTL: number = 5 * 60 * 1000; // 5 minutes default
  private queryCount: number = 0;
  private totalExecutionTime: number = 0;

  constructor(options: KuzuQueryEngineOptions = {}) {
    this.databasePath = options.databasePath || '/gitnexus_db';
    this.cacheEnabled = options.enableCache ?? true;
    this.maxCacheSize = options.cacheSize || 1000;
    this.cacheTTL = options.cacheTTL || 5 * 60 * 1000;
  }

  /**
   * Initialize the KuzuDB query engine
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log('✅ KuzuQueryEngine already initialized');
      return;
    }

    if (!isKuzuDBEnabled()) {
      console.log('⚠️ KuzuDB is disabled via feature flags');
      return;
    }

    try {
      console.log('🚀 Initializing KuzuQueryEngine...');
      
      // Initialize KuzuDB instance
      console.log('🔧 Step 1: Initializing KuzuDB instance...');
      this.kuzuInstance = await initKuzuDB();
      console.log('✅ Step 1 complete: KuzuDB instance initialized');
      
      // Create database
      console.log('🔧 Step 2: Creating database...');
      await this.kuzuInstance.createDatabase(this.databasePath);
      console.log('✅ Step 2 complete: Database created');
      
      // Initialize schema
      console.log('🔧 Step 3: Initializing schema...');
      await this.initializeSchema();
      console.log('✅ Step 3 complete: Schema initialized');
      
      this.isInitialized = true;
      console.log('✅ KuzuQueryEngine initialized successfully');
      
    } catch (error) {
      console.error('❌ Failed to initialize KuzuQueryEngine:', error);
      console.error('❌ Error details:', error);
      throw new Error(`KuzuQueryEngine initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Import a knowledge graph into KuzuDB
   */
  async importGraph(graph: KnowledgeGraph): Promise<void> {
    if (!this.isReady()) {
      throw new Error('KuzuQueryEngine not initialized. Call initialize() first.');
    }

    try {
      console.log(`🔄 Importing graph with ${graph.nodes.length} nodes and ${graph.relationships.length} relationships...`);
      
      const startTime = performance.now();
      
      // Import nodes in batches
      await this.importNodes(graph.nodes);
      
      // Import relationships in batches
      await this.importRelationships(graph.relationships);
      
      const importTime = performance.now() - startTime;
      console.log(`✅ Graph import completed in ${importTime.toFixed(2)}ms`);
      
      // Clear cache after import
      this.clearCache();
      
    } catch (error) {
      console.error('❌ Failed to import graph:', error);
      throw new Error(`Graph import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Execute a Cypher query with optional caching and optimization
   */
  async executeQuery(cypher: string, options: QueryOptions = {}): Promise<KuzuQueryResult> {
    if (!this.isReady()) {
      throw new Error('KuzuQueryEngine not initialized. Call initialize() first.');
    }

    const {
      timeout = 30000,
      maxResults = 1000,
      includeExecutionTime = true,
      useCache = this.cacheEnabled
    } = options;

    try {
      // Check cache first
      if (useCache) {
        const cachedResult = this.getCachedResult(cypher);
        if (cachedResult) {
          return cachedResult;
        }
      }

      // Execute query with timeout
      const queryPromise = this.executeQueryInternal(cypher, maxResults);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Query timeout')), timeout);
      });

      const result = await Promise.race([queryPromise, timeoutPromise]);
      
      // Cache successful results
      if (useCache && !result.error) {
        this.cacheResult(cypher, result);
      }

      // Update statistics
      this.queryCount++;
      this.totalExecutionTime += result.executionTime;

      return result;
      
    } catch (error) {
      console.error('❌ Query execution failed:', error);
      
      // Re-throw the error so that calling code can handle it (e.g., auto-recovery)
      throw error;
    }
  }

  /**
   * Execute a query and return graph nodes and relationships
   */
  async executeGraphQuery(cypher: string, options: QueryOptions = {}): Promise<{
    nodes: GraphNode[];
    relationships: GraphRelationship[];
    executionTime: number;
  }> {
    const result = await this.executeQuery(cypher, options);
    
    // Parse result into nodes and relationships
    const nodes: GraphNode[] = [];
    const relationships: GraphRelationship[] = [];
    
    // This is a simplified parser - in practice, you'd need to parse
    // the actual KuzuDB result format to extract nodes and relationships
    for (const row of result.rows) {
      // TODO: Implement proper parsing based on KuzuDB result format
      // This is a placeholder implementation
    }

    return {
      nodes,
      relationships,
      executionTime: result.executionTime
    };
  }

  /**
   * Get query engine statistics
   */
  getStatistics(): {
    isInitialized: boolean;
    queryCount: number;
    averageExecutionTime: number;
    cacheHitRate: number;
    cacheSize: number;
  } {
    const cacheHits = Object.values(this.queryCache).reduce((sum, entry) => sum + entry.hitCount, 0);
    const cacheHitRate = this.queryCount > 0 ? (cacheHits / this.queryCount) * 100 : 0;
    const averageExecutionTime = this.queryCount > 0 ? this.totalExecutionTime / this.queryCount : 0;

    return {
      isInitialized: this.isInitialized,
      queryCount: this.queryCount,
      averageExecutionTime,
      cacheHitRate,
      cacheSize: Object.keys(this.queryCache).length
    };
  }

  /**
   * Clear the query cache
   */
  clearCache(): void {
    this.queryCache = {};
    console.log('✅ Query cache cleared');
  }

  /**
   * Check if the query engine is ready for operations
   */
  isReady(): boolean {
    return this.isInitialized && this.kuzuInstance !== null && this.kuzuInstance.isReady();
  }

  /**
   * Close the query engine and cleanup resources
   */
  async close(): Promise<void> {
    try {
      if (this.kuzuInstance) {
        await this.kuzuInstance.closeDatabase();
        this.kuzuInstance = null;
      }
      
      this.isInitialized = false;
      this.clearCache();
      
      console.log('✅ KuzuQueryEngine closed successfully');
    } catch (error) {
      console.error('❌ Failed to close KuzuQueryEngine:', error);
      throw error;
    }
  }

  /**
   * Initialize the database schema with all required tables
   */
  private async initializeSchema(): Promise<void> {
    if (!this.kuzuInstance) {
      throw new Error('KuzuDB instance not available');
    }

    try {
      console.log('📋 Initializing KuzuDB schema...');

      // Use KuzuSchemaManager for complete and correct schema
      const { KuzuSchemaManager } = await import('../kuzu/kuzu-schema.ts');
      const schemaManager = new KuzuSchemaManager(this.kuzuInstance);
      await schemaManager.initializeSchema();
      
      // NOTE: Removed outdated createNodeTables() and createRelationshipTables() methods
      // KuzuSchemaManager now handles all schema creation with complete definitions
      
      console.log('✅ Schema initialization completed');
      
    } catch (error) {
      console.error('❌ Schema initialization failed:', error);
      throw error;
    }
  }

  /**
   * Create all node tables
   */
  private async createNodeTables(): Promise<void> {
    if (!this.kuzuInstance) return;

    const nodeTables = [
      {
        name: 'Project',
        schema: {
          id: 'STRING',
          name: 'STRING',
          path: 'STRING',
          description: 'STRING',
          version: 'STRING',
          createdAt: 'STRING'
        }
      },
      {
        name: 'Folder',
        schema: {
          id: 'STRING',
          name: 'STRING',
          path: 'STRING',
          fullPath: 'STRING',
          depth: 'INT64'
        }
      },
      {
        name: 'File',
        schema: {
          id: 'STRING',
          name: 'STRING',
          path: 'STRING',
          filePath: 'STRING',
          extension: 'STRING',
          language: 'STRING',
          size: 'INT64',
          definitionCount: 'INT64',
          lineCount: 'INT64'
        }
      },
      {
        name: 'Function',
        schema: {
          id: 'STRING',
          name: 'STRING',
          filePath: 'STRING',
          type: 'STRING',
          startLine: 'INT64',
          endLine: 'INT64',
          qualifiedName: 'STRING',
          parameters: 'STRING[]',
          returnType: 'STRING',
          accessibility: 'STRING',
          isStatic: 'BOOLEAN',
          isAsync: 'BOOLEAN',
          parentClass: 'STRING'
        }
      },
      {
        name: 'Class',
        schema: {
          id: 'STRING',
          name: 'STRING',
          filePath: 'STRING',
          startLine: 'INT64',
          endLine: 'INT64',
          qualifiedName: 'STRING',
          accessibility: 'STRING',
          isAbstract: 'BOOLEAN',
          extends: 'STRING[]',
          implements: 'STRING[]'
        }
      },
      {
        name: 'Method',
        schema: {
          id: 'STRING',
          name: 'STRING',
          filePath: 'STRING',
          startLine: 'INT64',
          endLine: 'INT64',
          qualifiedName: 'STRING',
          parameters: 'STRING[]',
          returnType: 'STRING',
          accessibility: 'STRING',
          isStatic: 'BOOLEAN',
          isAsync: 'BOOLEAN',
          parentClass: 'STRING'
        }
      },
      {
        name: 'Variable',
        schema: {
          id: 'STRING',
          name: 'STRING',
          filePath: 'STRING',
          startLine: 'INT64',
          endLine: 'INT64',
          type: 'STRING',
          accessibility: 'STRING',
          isStatic: 'BOOLEAN'
        }
      },
      {
        name: 'Interface',
        schema: {
          id: 'STRING',
          name: 'STRING',
          filePath: 'STRING',
          startLine: 'INT64',
          endLine: 'INT64',
          qualifiedName: 'STRING',
          extends: 'STRING[]'
        }
      },
      {
        name: 'Type',
        schema: {
          id: 'STRING',
          name: 'STRING',
          filePath: 'STRING',
          startLine: 'INT64',
          endLine: 'INT64',
          qualifiedName: 'STRING',
          typeDefinition: 'STRING'
        }
      }
    ];

    for (const table of nodeTables) {
      try {
        await this.kuzuInstance.createNodeTable(table.name, table.schema);
      } catch (error) {
        // Table might already exist, which is fine
        console.log(`ℹ️ Node table ${table.name} might already exist`);
      }
    }
  }

  /**
   * Create all relationship tables
   */
  private async createRelationshipTables(): Promise<void> {
    if (!this.kuzuInstance) return;

    const relationshipTables = [
      {
        name: 'CONTAINS',
        from: 'Project',
        to: 'Folder',
        schema: {}
      },
      {
        name: 'CALLS',
        from: 'Function',
        to: 'Function',
        schema: {
          confidence: 'DOUBLE',
          callType: 'STRING',
          stage: 'STRING',
          distance: 'INT64'
        }
      },
      {
        name: 'IMPORTS',
        from: 'File',
        to: 'File',
        schema: {
          importType: 'STRING',
          localName: 'STRING',
          exportedName: 'STRING'
        }
      },
      {
        name: 'INHERITS',
        from: 'Class',
        to: 'Class',
        schema: {
          inheritanceType: 'STRING'
        }
      }
    ];

    for (const table of relationshipTables) {
      try {
        await this.kuzuInstance.createRelTable(table.name, table.from, table.to, table.schema);
      } catch (error) {
        // Table might already exist, which is fine
        console.log(`ℹ️ Relationship table ${table.name} might already exist`);
      }
    }
  }

  /**
   * Import nodes in batches
   */
  private async importNodes(nodes: GraphNode[]): Promise<void> {
    if (!this.kuzuInstance) return;

    const batchSize = 100;
    const batches = Math.ceil(nodes.length / batchSize);

    for (let i = 0; i < batches; i++) {
      const batch = nodes.slice(i * batchSize, (i + 1) * batchSize);
      
      for (const node of batch) {
        try {
          await this.kuzuInstance.insertNode(node.label, {
            id: node.id,
            ...node.properties
          });
        } catch (error) {
          console.warn(`Failed to insert node ${node.id}:`, error);
        }
      }

      // Progress logging
      if (batches > 10 && i % Math.ceil(batches / 10) === 0) {
        console.log(`📊 Node import progress: ${Math.round((i / batches) * 100)}%`);
      }
    }
  }

  /**
   * Import relationships in batches
   */
  private async importRelationships(relationships: GraphRelationship[]): Promise<void> {
    if (!this.kuzuInstance) return;

    const batchSize = 100;
    const batches = Math.ceil(relationships.length / batchSize);

    for (let i = 0; i < batches; i++) {
      const batch = relationships.slice(i * batchSize, (i + 1) * batchSize);
      
      for (const rel of batch) {
        try {
          await this.kuzuInstance.insertRel(
            rel.type,
            rel.source,
            rel.target,
            rel.properties
          );
        } catch (error) {
          console.warn(`Failed to insert relationship ${rel.id}:`, error);
        }
      }

      // Progress logging
      if (batches > 10 && i % Math.ceil(batches / 10) === 0) {
        console.log(`📊 Relationship import progress: ${Math.round((i / batches) * 100)}%`);
      }
    }
  }

  /**
   * Execute query internally with performance monitoring
   */
  private async executeQueryInternal(cypher: string, maxResults: number): Promise<KuzuQueryResult> {
    if (!this.kuzuInstance) {
      throw new Error('KuzuDB instance not available');
    }

    const startTime = performance.now();
    
    try {
      const result = await this.kuzuInstance.executeQuery(cypher);
      const executionTime = performance.now() - startTime;

      // Ensure rows is a proper array and limit results if specified
      const rowsArray = Array.isArray(result.rows) ? result.rows : Array.from(result.rows || []);
      const limitedRows = maxResults > 0 ? rowsArray.slice(0, maxResults) : rowsArray;

      return {
        ...result,
        rows: limitedRows,
        resultCount: result.rowCount,
        executionTime
      };
    } catch (error) {
      const executionTime = performance.now() - startTime;
      throw new Error(`Query execution failed after ${executionTime.toFixed(2)}ms: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get cached query result if available and not expired
   */
  private getCachedResult(cypher: string): KuzuQueryResult | null {
    if (!this.cacheEnabled) return null;

    const queryHash = this.hashQuery(cypher);
    const cached = this.queryCache[queryHash];

    if (!cached) return null;

    // Check if cache entry has expired
    if (Date.now() - cached.timestamp > this.cacheTTL) {
      delete this.queryCache[queryHash];
      return null;
    }

    // Update hit count
    cached.hitCount++;
    
    return {
      ...cached.result,
      fromCache: true
    };
  }

  /**
   * Cache a query result
   */
  private cacheResult(cypher: string, result: KuzuQueryResult): void {
    if (!this.cacheEnabled) return;

    // Clean cache if it's getting too large
    if (Object.keys(this.queryCache).length >= this.maxCacheSize) {
      this.cleanCache();
    }

    const queryHash = this.hashQuery(cypher);
    this.queryCache[queryHash] = {
      result: { ...result },
      timestamp: Date.now(),
      hitCount: 0
    };
  }

  /**
   * Clean old cache entries
   */
  private cleanCache(): void {
    const now = Date.now();
    const entries = Object.entries(this.queryCache);
    
    // Remove expired entries
    entries.forEach(([hash, entry]) => {
      if (now - entry.timestamp > this.cacheTTL) {
        delete this.queryCache[hash];
      }
    });

    // If still too large, remove least recently used entries
    const remainingEntries = Object.entries(this.queryCache);
    if (remainingEntries.length >= this.maxCacheSize) {
      remainingEntries
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, Math.floor(this.maxCacheSize * 0.2))
        .forEach(([hash]) => delete this.queryCache[hash]);
    }
  }

  /**
   * Generate a hash for a query string
   */
  private hashQuery(cypher: string): string {
    // Simple hash function for query caching
    let hash = 0;
    for (let i = 0; i < cypher.length; i++) {
      const char = cypher.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  }

  /**
   * Get the KuzuDB instance for direct access (used by auto-recovery)
   */
  getKuzuInstance(): KuzuInstance {
    if (!this.kuzuInstance) {
      throw new Error('KuzuDB instance not available. Call initialize() first.');
    }
    return this.kuzuInstance;
  }
}

