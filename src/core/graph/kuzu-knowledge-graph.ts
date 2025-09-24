/**
 * KuzuDB Knowledge Graph Implementation
 * 
 * This module provides a KnowledgeGraph implementation that uses KuzuDB
 * as the storage backend, maintaining compatibility with the existing
 * GitNexus pipeline while providing enhanced query capabilities.
 */

import type { KnowledgeGraph, GraphNode, GraphRelationship, NodeLabel, RelationshipType } from './types.ts';
import type { KuzuQueryEngine, KuzuQueryResult } from './kuzu-query-engine.ts';
import { generateId } from '../../lib/utils.ts';
import { GitNexusCSVGenerator, CSVUtils } from '../kuzu/csv-generator.ts';
import { isKuzuCopyEnabled } from '../../config/features.ts';

export interface KuzuGraphOptions {
  enableCache?: boolean;
  batchSize?: number;
  autoCommit?: boolean;
}

/**
 * KuzuDB-backed implementation of the KnowledgeGraph interface
 * 
 * This class provides a drop-in replacement for SimpleKnowledgeGraph
 * while leveraging KuzuDB's graph database capabilities.
 */
export class KuzuKnowledgeGraph implements KnowledgeGraph {
  private queryEngine: KuzuQueryEngine;
  private options: KuzuGraphOptions;
  private pendingNodes: GraphNode[] = [];
  private pendingRelationships: GraphRelationship[] = [];
  private nodeCache: Map<string, GraphNode> = new Map();
  private relationshipCache: Map<string, GraphRelationship> = new Map();
  private cacheEnabled: boolean = true;
  private batchSize: number = 100;
  private autoCommit: boolean = true;

  constructor(queryEngine: KuzuQueryEngine, options: KuzuGraphOptions = {}) {
    this.queryEngine = queryEngine;
    this.options = options;
    this.cacheEnabled = options.enableCache ?? true;
    this.batchSize = options.batchSize ?? 100;
    this.autoCommit = options.autoCommit ?? true;
  }

  /**
   * Commit all pending operations to KuzuDB
   */
  async commitAll(): Promise<void> {
    if (this.pendingNodes.length > 0) {
      await this.flushNodes();
    }
    if (this.pendingRelationships.length > 0) {
      await this.flushRelationships();
    }
  }

  /**
   * Flush pending nodes to KuzuDB using batch operations
   */
  private async flushNodes(): Promise<void> {
    if (this.pendingNodes.length === 0) return;

    try {
      console.log(`🚀 BATCH: Starting batch commit of ${this.pendingNodes.length} nodes`);
      
      // Group nodes by label for batch processing
      const nodesByLabel = this.groupNodesByLabel(this.pendingNodes);
      
      // Process each label as a batch
      for (const [label, nodes] of Object.entries(nodesByLabel)) {
        await this.commitNodesBatch(label, nodes);
      }
      
      this.pendingNodes = [];
      console.log(`✅ BATCH: Successfully committed all nodes in batches`);
    } catch (error) {
      console.error('Failed to flush nodes to KuzuDB:', error);
      throw error;
    }
  }

  /**
   * Commit a single node with auto-recovery for missing tables
   */
  public async commitSingleNode(node: GraphNode): Promise<void> {
    try {
      const tableName = node.label;
      
      // Filter properties based on schema to prevent "Cannot find property" errors
      const filteredProperties = await this.filterPropertiesForSchema(node.properties, node.label);
      const nodeData = { id: node.id, ...filteredProperties };
      
      await this.queryEngine.executeQuery(
        `MERGE (n:${tableName} ${this.formatPropertiesForQuery(nodeData)})`
      );
    } catch (error) {
      // Auto-recovery for missing node tables
      if (error instanceof Error && error.message.includes('Table') && error.message.includes('does not exist')) {
        console.log(`🔧 Table ${node.label} does not exist, attempting to create it...`);
        await this.handleMissingNodeTable(node.label);
        
        // Retry the insertion after creating the table
        const filteredProperties = await this.filterPropertiesForSchema(node.properties, node.label);
        const nodeData = { id: node.id, ...filteredProperties };
        await this.queryEngine.executeQuery(
          `MERGE (n:${node.label} ${this.formatPropertiesForQuery(nodeData)})`
        );
        console.log(`✅ Successfully inserted node ${node.id} after table creation`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Flush pending relationships to KuzuDB using batch operations
   */
  private async flushRelationships(): Promise<void> {
    if (this.pendingRelationships.length === 0) return;

    try {
      console.log(`🚀 BATCH: Starting batch commit of ${this.pendingRelationships.length} relationships`);
      
      // Group relationships by type for batch processing
      const relsByType = this.groupRelationshipsByType(this.pendingRelationships);
      
      // Process each type as a batch
      for (const [type, relationships] of Object.entries(relsByType)) {
        await this.commitRelationshipsBatch(type, relationships);
      }
      
      this.pendingRelationships = [];
      console.log(`✅ BATCH: Successfully committed all relationships in batches`);
    } catch (error) {
      console.error('Failed to flush relationships to KuzuDB:', error);
      throw error;
    }
  }

  /**
   * Commit a single relationship with auto-recovery for missing tables
   */
  public async commitSingleRelationship(rel: GraphRelationship): Promise<void> {
    try {
      await this.queryEngine.executeQuery(
        `MATCH (a {id: '${rel.source}'}), (b {id: '${rel.target}'}) MERGE (a)-[:${rel.type} ${this.formatPropertiesForQuery(rel.properties)}]->(b)`
      );
    } catch (error) {
      console.error(`❌ Error executing relationship query for ${rel.type}:`, error);
      
      // Auto-recovery for missing relationship tables
      if (error instanceof Error && error.message.includes('Table') && error.message.includes('does not exist')) {
        console.log(`🔧 Relationship table ${rel.type} does not exist, attempting to create it...`);
        
        try {
          await this.handleMissingRelationshipTable(rel.type);
          
          // Retry the insertion after creating the table
          console.log(`🔄 Retrying relationship insertion for ${rel.type}...`);
          await this.queryEngine.executeQuery(
            `MATCH (a {id: '${rel.source}'}), (b {id: '${rel.target}'}) MERGE (a)-[:${rel.type} ${this.formatPropertiesForQuery(rel.properties)}]->(b)`
          );
          console.log(`✅ Successfully inserted relationship ${rel.id} after table creation`);
          
        } catch (recoveryError) {
          console.error(`❌ Auto-recovery failed for ${rel.type}:`, recoveryError);
          throw new Error(`Failed to create missing table ${rel.type}: ${recoveryError instanceof Error ? recoveryError.message : 'Unknown error'}`);
        }
      } else {
        throw error;
      }
    }
  }

  /**
   * Group nodes by label for batch processing
   */
  private groupNodesByLabel(nodes: GraphNode[]): Record<string, GraphNode[]> {
    return nodes.reduce((groups, node) => {
      if (!groups[node.label]) groups[node.label] = [];
      groups[node.label].push(node);
      return groups;
    }, {} as Record<string, GraphNode[]>);
  }

  /**
   * Group relationships by type for batch processing
   */
  private groupRelationshipsByType(relationships: GraphRelationship[]): Record<string, GraphRelationship[]> {
    return relationships.reduce((groups, rel) => {
      if (!groups[rel.type]) groups[rel.type] = [];
      groups[rel.type].push(rel);
      return groups;
    }, {} as Record<string, GraphRelationship[]>);
  }

  /**
   * Commit a batch of nodes with COPY optimization and MERGE fallback
   */
  private async commitNodesBatch(label: string, nodes: GraphNode[]): Promise<void> {
    if (nodes.length === 0) return;
    
    // Check if COPY is enabled and supported
    if (this.isCopyEnabled() && await this.isCopySupported()) {
      try {
        await this.commitNodesBatchWithCOPY(label, nodes);
        return; // Success with COPY
      } catch (copyError) {
        console.warn(`⚠️ COPY-BULK: COPY failed for ${label}, falling back to MERGE batch:`, copyError.message);
        // Fall through to MERGE approach
      }
    } else if (!this.isCopyEnabled()) {
      console.log(`🔄 MERGE-BATCH: COPY disabled, using MERGE batch for ${nodes.length} ${label} nodes`);
    } else {
      console.log(`🔄 MERGE-BATCH: COPY not supported, using MERGE batch for ${nodes.length} ${label} nodes`);
    }
    
    // Fallback to current MERGE approach
    await this.commitNodesBatchWithMERGE(label, nodes);
  }

  /**
   * Original MERGE-based batch commit (kept as fallback)
   */
  private async commitNodesBatchWithMERGE(label: string, nodes: GraphNode[]): Promise<void> {
    if (nodes.length === 0) return;
    
    try {
      console.log(`🔄 BATCH: Committing ${nodes.length} ${label} nodes in single query`);
      
      // Build individual MERGE statements for batch execution
      const mergeStatements = await Promise.all(
        nodes.map(async (node) => {
          const filteredProps = await this.filterPropertiesForSchema(node.properties, node.label);
          const nodeData = { id: node.id, ...filteredProps };
          return `MERGE (n:${label} ${this.formatPropertiesForQuery(nodeData)})`;
        })
      );
      
      // Execute all MERGE statements in a single query
      const batchQuery = mergeStatements.join(';\n');
      
      await this.queryEngine.executeQuery(batchQuery);
      console.log(`✅ BATCH: Successfully committed ${nodes.length} ${label} nodes`);
      
    } catch (error) {
      console.warn(`⚠️ BATCH: Batch commit failed for ${label} nodes, falling back to individual commits:`, error);
      
      // Fallback to individual commits if batch fails
      for (const node of nodes) {
        try {
          await this.commitSingleNode(node);
        } catch (individualError) {
          console.error(`❌ BATCH: Individual commit also failed for node ${node.id}:`, individualError);
          throw individualError;
        }
      }
    }
  }

  /**
   * Commit a batch of relationships with COPY optimization and MERGE fallback
   */
  private async commitRelationshipsBatch(type: string, relationships: GraphRelationship[]): Promise<void> {
    if (relationships.length === 0) return;
    
    // TODO: COPY for relationships needs different approach - disable for now
    // Relationships in KuzuDB work differently than nodes (FROM/TO vs source/target columns)
    console.log(`🔄 MERGE-BATCH: Using MERGE for ${relationships.length} ${type} relationships (COPY not yet supported for relationships)`);
    
    /* Disabled until relationship COPY is properly implemented
    // Check if COPY is enabled and supported
    if (this.isCopyEnabled() && await this.isCopySupported()) {
      try {
        await this.commitRelationshipsBatchWithCOPY(type, relationships);
        return; // Success with COPY
      } catch (copyError) {
        console.warn(`⚠️ COPY-BULK: COPY failed for ${type}, falling back to MERGE batch:`, copyError.message);
        // Fall through to MERGE approach
      }
    } else if (!this.isCopyEnabled()) {
      console.log(`🔄 MERGE-BATCH: COPY disabled, using MERGE batch for ${relationships.length} ${type} relationships`);
    } else {
      console.log(`🔄 MERGE-BATCH: COPY not supported, using MERGE batch for ${relationships.length} ${type} relationships`);
    }
    */
    
    // Fallback to current MERGE approach
    await this.commitRelationshipsBatchWithMERGE(type, relationships);
  }

  /**
   * Original MERGE-based relationship commit (kept as fallback)
   */
  private async commitRelationshipsBatchWithMERGE(type: string, relationships: GraphRelationship[]): Promise<void> {
    if (relationships.length === 0) return;
    
    try {
      console.log(`🔄 BATCH: Committing ${relationships.length} ${type} relationships in single query`);
      
      // Build individual MERGE statements for batch execution
      const mergeStatements = relationships.map(rel => {
        const props = Object.keys(rel.properties).length > 0 
          ? this.formatPropertiesForQuery(rel.properties)
          : '';
        const propsStr = props ? ` ${props}` : '';
        return `MATCH (a {id: '${rel.source}'}), (b {id: '${rel.target}'}) MERGE (a)-[:${type}${propsStr}]->(b)`;
      });
      
      // Execute all MERGE statements in a single query
      const batchQuery = mergeStatements.join(';\n');
      
      await this.queryEngine.executeQuery(batchQuery);
      console.log(`✅ BATCH: Successfully committed ${relationships.length} ${type} relationships`);
      
    } catch (error) {
      console.warn(`⚠️ BATCH: Batch commit failed for ${type} relationships, falling back to individual commits:`, error);
      
      // Fallback to individual commits if batch fails
      for (const rel of relationships) {
        try {
          await this.commitSingleRelationship(rel);
        } catch (individualError) {
          console.error(`❌ BATCH: Individual commit also failed for relationship ${rel.id}:`, individualError);
          throw individualError;
        }
      }
    }
  }

  /**
   * Get all nodes in the graph (cached or from database)
   */
  get nodes(): GraphNode[] {
    if (this.cacheEnabled && this.nodeCache.size > 0) {
      return Array.from(this.nodeCache.values());
    }
    
    // For compatibility, we need to return a synchronous result
    // In practice, this should be replaced with async methods
    console.warn('KuzuKnowledgeGraph.nodes getter is synchronous but KuzuDB is async. Consider using getNodesAsync()');
    return [];
  }

  /**
   * Get all relationships in the graph (cached or from database)
   */
  get relationships(): GraphRelationship[] {
    if (this.cacheEnabled && this.relationshipCache.size > 0) {
      return Array.from(this.relationshipCache.values());
    }
    
    // For compatibility, we need to return a synchronous result
    // In practice, this should be replaced with async methods
    console.warn('KuzuKnowledgeGraph.relationships getter is synchronous but KuzuDB is async. Consider using getRelationshipsAsync()');
    return [];
  }

  /**
   * Add a node to the graph
   */
  addNode(node: GraphNode): void {
    // Add to pending batch
    this.pendingNodes.push(node);
    
    // Update cache
    if (this.cacheEnabled) {
      this.nodeCache.set(node.id, node);
    }

    // Auto-commit if batch size reached
    if (this.autoCommit && this.pendingNodes.length >= this.batchSize) {
      this.commitNodesAsync().catch(error => {
        console.error('Failed to auto-commit nodes:', error);
      });
    }
  }

  /**
   * Add a relationship to the graph
   */
  addRelationship(relationship: GraphRelationship): void {
    // Add to pending batch
    this.pendingRelationships.push(relationship);
    
    // Update cache
    if (this.cacheEnabled) {
      this.relationshipCache.set(relationship.id, relationship);
    }

    // Auto-commit if batch size reached
    if (this.autoCommit && this.pendingRelationships.length >= this.batchSize) {
      this.commitRelationshipsAsync().catch(error => {
        console.error('Failed to auto-commit relationships:', error);
      });
    }
  }

  /**
   * Get nodes asynchronously with optional filtering
   */
  async getNodesAsync(filter?: {
    label?: NodeLabel;
    properties?: Record<string, any>;
    limit?: number;
  }): Promise<GraphNode[]> {
    try {
      let cypher = 'MATCH (n) RETURN n';
      
      if (filter?.label) {
        cypher = `MATCH (n:${filter.label}) RETURN n`;
      }

      if (filter?.properties) {
        const conditions = Object.entries(filter.properties)
          .map(([key, value]) => `n.${key} = ${this.formatValue(value)}`)
          .join(' AND ');
        cypher += ` WHERE ${conditions}`;
      }

      if (filter?.limit) {
        cypher += ` LIMIT ${filter.limit}`;
      }

      const result = await this.queryEngine.executeQuery(cypher);
      return this.parseNodesFromResult(result);
    } catch (error) {
      console.error('Failed to get nodes:', error);
      return [];
    }
  }

  /**
   * Get relationships asynchronously with optional filtering
   */
  async getRelationshipsAsync(filter?: {
    type?: RelationshipType;
    sourceId?: string;
    targetId?: string;
    properties?: Record<string, any>;
    limit?: number;
  }): Promise<GraphRelationship[]> {
    try {
      let cypher = 'MATCH ()-[r]->() RETURN r';
      
      if (filter?.type) {
        cypher = `MATCH ()-[r:${filter.type}]->() RETURN r`;
      }

      const conditions: string[] = [];
      
      if (filter?.properties) {
        Object.entries(filter.properties).forEach(([key, value]) => {
          conditions.push(`r.${key} = ${this.formatValue(value)}`);
        });
      }

      if (conditions.length > 0) {
        cypher += ` WHERE ${conditions.join(' AND ')}`;
      }

      if (filter?.limit) {
        cypher += ` LIMIT ${filter.limit}`;
      }

      const result = await this.queryEngine.executeQuery(cypher);
      return this.parseRelationshipsFromResult(result);
    } catch (error) {
      console.error('Failed to get relationships:', error);
      return [];
    }
  }

  /**
   * Find nodes by label
   */
  async findNodesByLabel(label: NodeLabel, limit?: number): Promise<GraphNode[]> {
    return this.getNodesAsync({ label, limit });
  }

  /**
   * Find node by ID
   */
  async findNodeById(id: string): Promise<GraphNode | null> {
    try {
      const cypher = `MATCH (n) WHERE n.id = ${this.formatValue(id)} RETURN n LIMIT 1`;
      const result = await this.queryEngine.executeQuery(cypher);
      const nodes = this.parseNodesFromResult(result);
      return nodes.length > 0 ? nodes[0] : null;
    } catch (error) {
      console.error(`Failed to find node by ID ${id}:`, error);
      return null;
    }
  }

  /**
   * Find relationships by type
   */
  async findRelationshipsByType(type: RelationshipType, limit?: number): Promise<GraphRelationship[]> {
    return this.getRelationshipsAsync({ type, limit });
  }

  /**
   * Get nodes connected to a specific node
   */
  async getConnectedNodes(nodeId: string, relationshipType?: RelationshipType): Promise<{
    outgoing: GraphNode[];
    incoming: GraphNode[];
  }> {
    try {
      const typeFilter = relationshipType ? `:${relationshipType}` : '';
      
      // Get outgoing connections
      const outgoingCypher = `
        MATCH (source)-[r${typeFilter}]->(target) 
        WHERE source.id = ${this.formatValue(nodeId)} 
        RETURN target
      `;
      const outgoingResult = await this.queryEngine.executeQuery(outgoingCypher);
      const outgoing = this.parseNodesFromResult(outgoingResult);

      // Get incoming connections
      const incomingCypher = `
        MATCH (source)-[r${typeFilter}]->(target) 
        WHERE target.id = ${this.formatValue(nodeId)} 
        RETURN source
      `;
      const incomingResult = await this.queryEngine.executeQuery(incomingCypher);
      const incoming = this.parseNodesFromResult(incomingResult);

      return { outgoing, incoming };
    } catch (error) {
      console.error(`Failed to get connected nodes for ${nodeId}:`, error);
      return { outgoing: [], incoming: [] };
    }
  }

  /**
   * Execute a custom Cypher query
   */
  async executeQuery(cypher: string): Promise<KuzuQueryResult> {
    return this.queryEngine.executeQuery(cypher);
  }

  /**
   * Get graph statistics
   */
  async getStatistics(): Promise<{
    nodeCount: number;
    relationshipCount: number;
    nodesByLabel: Record<string, number>;
    relationshipsByType: Record<string, number>;
  }> {
    try {
      // Get total node count
      const nodeCountResult = await this.queryEngine.executeQuery('MATCH (n) RETURN COUNT(n) as count');
      const nodeCount = nodeCountResult.rows[0]?.[0] || 0;

      // Get total relationship count
      const relCountResult = await this.queryEngine.executeQuery('MATCH ()-[r]->() RETURN COUNT(r) as count');
      const relationshipCount = relCountResult.rows[0]?.[0] || 0;

      // Get nodes by label (KuzuDB-compatible)
      const nodesByLabel: Record<string, number> = {};
      const nodeTypes = ['Function', 'Class', 'Method', 'File', 'Variable', 'Interface', 'Type', 'Import', 'Project', 'Folder'];
      
      for (const nodeType of nodeTypes) {
        try {
          const result = await this.queryEngine.executeQuery(`MATCH (n:${nodeType}) RETURN COUNT(n) as count`);
          const count = result.rows?.[0]?.[0] || 0;
          if (count > 0) {
            nodesByLabel[nodeType] = count;
          }
        } catch (error) {
          // Node type might not exist in this database, skip silently
        }
      }

      // Get relationships by type (KuzuDB-compatible)
      const relationshipsByType: Record<string, number> = {};
      const relTypes = ['CONTAINS', 'CALLS', 'INHERITS', 'IMPLEMENTS', 'OVERRIDES', 'IMPORTS', 'DEFINES', 'BELONGS_TO', 'USES', 'ACCESSES', 'EXTENDS'];
      
      for (const relType of relTypes) {
        try {
          const result = await this.queryEngine.executeQuery(`MATCH ()-[r:${relType}]->() RETURN COUNT(r) as count`);
          const count = result.rows?.[0]?.[0] || 0;
          if (count > 0) {
            relationshipsByType[relType] = count;
          }
        } catch (error) {
          // Relationship type might not exist in this database, skip silently
        }
      }

      return {
        nodeCount,
        relationshipCount,
        nodesByLabel,
        relationshipsByType
      };
    } catch (error) {
      console.error('Failed to get graph statistics:', error);
      return {
        nodeCount: 0,
        relationshipCount: 0,
        nodesByLabel: {},
        relationshipsByType: {}
      };
    }
  }

  /**
   * Commit pending nodes to the database
   */
  async commitNodes(): Promise<void> {
    if (this.pendingNodes.length === 0) return;

    try {
      console.log(`📝 Committing ${this.pendingNodes.length} nodes to KuzuDB...`);
      
      for (const node of this.pendingNodes) {
        await this.commitSingleNode(node);
      }

      this.pendingNodes = [];
      console.log('✅ Nodes committed successfully');
    } catch (error) {
      console.error('❌ Failed to commit nodes:', error);
      throw error;
    }
  }

  /**
   * Commit pending relationships to the database
   */
  async commitRelationships(): Promise<void> {
    if (this.pendingRelationships.length === 0) return;

    try {
      console.log(`📝 Committing ${this.pendingRelationships.length} relationships to KuzuDB...`);
      
      for (const relationship of this.pendingRelationships) {
        await this.commitSingleRelationship(relationship);
      }

      this.pendingRelationships = [];
      console.log('✅ Relationships committed successfully');
    } catch (error) {
      console.error('❌ Failed to commit relationships:', error);
      throw error;
    }
  }


  /**
   * Clear all caches
   */
  clearCache(): void {
    this.nodeCache.clear();
    this.relationshipCache.clear();
    console.log('✅ Graph caches cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStatistics(): {
    nodesCached: number;
    relationshipsCached: number;
    pendingNodes: number;
    pendingRelationships: number;
  } {
    return {
      nodesCached: this.nodeCache.size,
      relationshipsCached: this.relationshipCache.size,
      pendingNodes: this.pendingNodes.length,
      pendingRelationships: this.pendingRelationships.length
    };
  }

  /**
   * Private: Commit nodes asynchronously (for auto-commit)
   */
  private async commitNodesAsync(): Promise<void> {
    try {
      await this.commitNodes();
    } catch (error) {
      console.error('Auto-commit nodes failed:', error);
    }
  }

  /**
   * Private: Commit relationships asynchronously (for auto-commit)
   */
  private async commitRelationshipsAsync(): Promise<void> {
    try {
      await this.commitRelationships();
    } catch (error) {
      console.error('Auto-commit relationships failed:', error);
    }
  }



  /**
   * Private: Parse nodes from query result
   */
  private parseNodesFromResult(result: KuzuQueryResult): GraphNode[] {
    // This is a placeholder implementation
    // In practice, you'd need to parse the actual KuzuDB result format
    const nodes: GraphNode[] = [];
    
    try {
      for (const row of result.rows) {
        // TODO: Implement proper parsing based on KuzuDB result format
        // This would depend on how KuzuDB returns node data
        
        // Placeholder node creation
        if (row.length > 0) {
          const nodeData = row[0]; // Assuming first column contains node data
          
          // This is a simplified example - actual implementation would vary
          if (typeof nodeData === 'object' && nodeData.id) {
            nodes.push({
              id: nodeData.id,
              label: nodeData.label || 'Unknown',
              properties: nodeData.properties || {}
            });
          }
        }
      }
    } catch (error) {
      console.error('Failed to parse nodes from result:', error);
    }

    return nodes;
  }

  /**
   * Private: Parse relationships from query result
   */
  private parseRelationshipsFromResult(result: KuzuQueryResult): GraphRelationship[] {
    // This is a placeholder implementation
    // In practice, you'd need to parse the actual KuzuDB result format
    const relationships: GraphRelationship[] = [];
    
    try {
      for (const row of result.rows) {
        // TODO: Implement proper parsing based on KuzuDB result format
        // This would depend on how KuzuDB returns relationship data
        
        // Placeholder relationship creation
        if (row.length > 0) {
          const relData = row[0]; // Assuming first column contains relationship data
          
          // This is a simplified example - actual implementation would vary
          if (typeof relData === 'object' && relData.id) {
            relationships.push({
              id: relData.id || generateId('rel'),
              type: relData.type || 'UNKNOWN',
              source: relData.source || '',
              target: relData.target || '',
              properties: relData.properties || {}
            });
          }
        }
      }
    } catch (error) {
      console.error('Failed to parse relationships from result:', error);
    }

    return relationships;
  }

  /**
   * Private: Format a value for use in Cypher queries
   */
  private formatValue(value: any): string {
    if (typeof value === 'string') {
      return `'${value.replace(/'/g, "\\'")}'`;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    } else if (Array.isArray(value)) {
      return '[' + value.map(v => this.formatValue(v)).join(', ') + ']';
    } else if (value === null || value === undefined) {
      return 'null';
    } else {
      return `'${String(value).replace(/'/g, "\\'")}'`;
    }
    }

  /**
   * Format properties object for Cypher queries
   */
  private formatPropertiesForQuery(properties: Record<string, any>): string {
    const props = Object.entries(properties)
      .filter(([_, value]) => value !== null && value !== undefined) // Filter out null/undefined
      .map(([key, value]) => `${key}: ${this.formatValue(value)}`)
      .join(', ');
    return `{${props}}`;
  }

  /**
   * Filter properties based on KuzuDB schema to prevent "Cannot find property" errors
   */
  private async filterPropertiesForSchema(properties: Record<string, any>, nodeLabel: NodeLabel): Promise<Record<string, any>> {
    try {
      const { NODE_TABLE_SCHEMAS } = await import('../kuzu/kuzu-schema.ts');
      const schema = NODE_TABLE_SCHEMAS[nodeLabel];
      
      if (!schema) {
        console.warn(`No schema found for node label: ${nodeLabel}, using all properties`);
        return properties;
      }
      
      const filteredProperties: Record<string, any> = {};
      for (const [key, value] of Object.entries(properties)) {
        if (key in schema) {
          filteredProperties[key] = value;
        } else {
          console.debug(`Dropping property '${key}' for ${nodeLabel} node (not in schema)`);
        }
      }
      
      return filteredProperties;
    } catch (error) {
      console.warn(`Failed to filter properties for ${nodeLabel}:`, error);
      return properties;
    }
  }

  /**
   * Handle missing node table by recreating it
   */
  private async handleMissingNodeTable(nodeLabel: NodeLabel): Promise<void> {
    try {
      console.log(`🔧 Attempting to create missing node table: ${nodeLabel}`);
      const { KuzuSchemaManager } = await import('../kuzu/kuzu-schema.ts');
      const schemaManager = new KuzuSchemaManager(this.queryEngine.getKuzuInstance());
      await schemaManager.recreateNodeTable(nodeLabel);
      console.log(`✅ Successfully created node table: ${nodeLabel}`);
    } catch (error) {
      console.error(`❌ Failed to create node table ${nodeLabel}:`, error);
      throw error;
    }
  }

  /**
   * Handle missing relationship table by recreating it
   */
  private async handleMissingRelationshipTable(relationshipType: RelationshipType): Promise<void> {
    try {
      console.log(`🔧 Attempting to create missing relationship table: ${relationshipType}`);
      const { KuzuSchemaManager } = await import('../kuzu/kuzu-schema.ts');
      const schemaManager = new KuzuSchemaManager(this.queryEngine.getKuzuInstance());
      await schemaManager.recreateRelationshipTable(relationshipType);
      console.log(`✅ Successfully created relationship table: ${relationshipType}`);
    } catch (error) {
      console.error(`❌ Failed to create relationship table ${relationshipType}:`, error);
      throw error;
    }
  }

  /**
   * Commit nodes using COPY statement (new optimized approach)
   */
  private async commitNodesBatchWithCOPY(label: string, nodes: GraphNode[]): Promise<void> {
    if (nodes.length === 0) return;
    
    const startTime = performance.now();
    
    try {
      console.log(`🚀 COPY-BULK: Loading ${nodes.length} ${label} nodes via COPY statement`);
      
      // Generate CSV data
      const csvData = GitNexusCSVGenerator.generateNodeCSV(nodes, label as NodeLabel);
      if (!csvData) {
        console.warn(`⚠️ COPY-BULK: No CSV data generated for ${label} nodes`);
        return;
      }
      
      // Write to WASM filesystem with unique filename
      const timestamp = Date.now();
      const csvPath = `/temp_${label}_nodes_${timestamp}.csv`;
      
      // Access FS API through query engine
      const kuzuFS = await this.getKuzuFS();
      
      const writeResult = await kuzuFS.writeFile(csvPath, csvData);
      
      // Debug: Read back what was written for problematic function only
      const readData = await kuzuFS.readFile(csvPath);
      
      // Convert read data to string for COPY operation
      let readBack: string;
      if (typeof readData === 'string') {
        readBack = readData;
      } else if (readData instanceof Uint8Array || readData instanceof ArrayBuffer) {
        readBack = new TextDecoder().decode(readData);
      } else {
        readBack = String(readData);
      }
      
      // Execute COPY statement
      const copyQuery = `COPY ${label} FROM '${csvPath}'`;
      const result = await this.queryEngine.executeQuery(copyQuery);
      // Note: COPY result doesn't need to be closed
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      console.log(`✅ COPY-BULK: Successfully loaded ${nodes.length} ${label} nodes in ${duration.toFixed(2)}ms (${csvData.length} bytes CSV)`);
      
      // Verify data was written by querying the count
      try {
        const verifyResult = await this.queryEngine.executeQuery(`MATCH (n:${label}) RETURN COUNT(n) as count`);
        const totalCount = verifyResult.rows?.[0]?.[0] || 0;
        console.log(`📊 COPY-BULK: KuzuDB now contains ${totalCount} total ${label} nodes`);
      } catch (verifyError) {
        console.warn(`⚠️ COPY-BULK: Could not verify ${label} count:`, verifyError.message);
      }
      
    } catch (error) {
      console.error(`❌ COPY-BULK: Failed to load ${label} nodes:`, error);
      // Re-throw with more context for better debugging
      throw new Error(`COPY operation failed for ${label}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Commit relationships using COPY statement (new optimized approach)
   */
  private async commitRelationshipsBatchWithCOPY(type: string, relationships: GraphRelationship[]): Promise<void> {
    if (relationships.length === 0) return;
    
    const startTime = performance.now();
    
    try {
      console.log(`🚀 COPY-BULK: Loading ${relationships.length} ${type} relationships via COPY statement`);
      
      // Generate CSV data
      const csvData = GitNexusCSVGenerator.generateRelationshipCSV(relationships, type as RelationshipType);
      if (!csvData) {
        console.warn(`⚠️ COPY-BULK: No CSV data generated for ${type} relationships`);
        return;
      }
      
      // Write to WASM filesystem
      const timestamp = Date.now();
      const csvPath = `/temp_${type}_rels_${timestamp}.csv`;
      
      const kuzuFS = await this.getKuzuFS();
      await kuzuFS.writeFile(csvPath, csvData);
      
      // Execute COPY statement
      const copyQuery = `COPY ${type} FROM '${csvPath}'`;
      const result = await this.queryEngine.executeQuery(copyQuery);
      // Note: COPY result doesn't need to be closed
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      console.log(`✅ COPY-BULK: Successfully loaded ${relationships.length} ${type} relationships in ${duration.toFixed(2)}ms (${csvData.length} bytes CSV)`);
      
      // Verify data was written by querying the count
      try {
        const verifyResult = await this.queryEngine.executeQuery(`MATCH ()-[r:${type}]->() RETURN COUNT(r) as count`);
        const totalCount = verifyResult.rows?.[0]?.[0] || 0;
        console.log(`📊 COPY-BULK: KuzuDB now contains ${totalCount} total ${type} relationships`);
      } catch (verifyError) {
        console.warn(`⚠️ COPY-BULK: Could not verify ${type} count:`, verifyError.message);
      }
      
    } catch (error) {
      console.error(`❌ COPY-BULK: Failed to load ${type} relationships:`, error);
      // Re-throw with more context for better debugging
      throw new Error(`COPY operation failed for ${type}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get access to KuzuDB FS API
   */
  private async getKuzuFS(): Promise<any> {
    // Access FS through the query engine's kuzu instance
    const kuzuInstance = this.queryEngine.getKuzuInstance();
    const fs = kuzuInstance.getFS();
    
    if (!fs || !fs.writeFile) {
      throw new Error('KuzuDB FS API not available');
    }
    
    return fs;
  }

  /**
   * Check if COPY approach is enabled via feature flag
   */
  private isCopyEnabled(): boolean {
    return isKuzuCopyEnabled();
  }

  /**
   * Check if COPY approach is supported in current environment
   */
  private async isCopySupported(): Promise<boolean> {
    try {
      const kuzuFS = await this.getKuzuFS();
      return !!(kuzuFS && kuzuFS.writeFile);
    } catch (error) {
      return false;
    }
  }

}

