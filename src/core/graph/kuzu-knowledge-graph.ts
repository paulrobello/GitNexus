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
  private pendingNodes: GraphNode[] = [];
  private pendingRelationships: GraphRelationship[] = [];
  private nodeCache: Map<string, GraphNode> = new Map();
  private relationshipCache: Map<string, GraphRelationship> = new Map();
  private cacheEnabled: boolean = true;
  private batchSize: number = 100;
  private autoCommit: boolean = true;

  constructor(queryEngine: KuzuQueryEngine, options: KuzuGraphOptions = {}) {
    this.queryEngine = queryEngine;
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
   * Flush pending nodes to KuzuDB
   */
  private async flushNodes(): Promise<void> {
    if (this.pendingNodes.length === 0) return;

    try {
      for (const node of this.pendingNodes) {
        await this.commitSingleNode(node);
      }
      this.pendingNodes = [];
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
   * Flush pending relationships to KuzuDB
   */
  private async flushRelationships(): Promise<void> {
    if (this.pendingRelationships.length === 0) return;

    try {
      for (const rel of this.pendingRelationships) {
        await this.commitSingleRelationship(rel);
      }
      this.pendingRelationships = [];
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

      // Get nodes by label
      const nodesByLabelResult = await this.queryEngine.executeQuery(`
        MATCH (n) 
        RETURN labels(n)[0] as label, COUNT(n) as count 
        ORDER BY count DESC
      `);
      const nodesByLabel: Record<string, number> = {};
      nodesByLabelResult.rows.forEach(row => {
        nodesByLabel[row[0]] = row[1];
      });

      // Get relationships by type
      const relsByTypeResult = await this.queryEngine.executeQuery(`
        MATCH ()-[r]->() 
        RETURN type(r) as type, COUNT(r) as count 
        ORDER BY count DESC
      `);
      const relationshipsByType: Record<string, number> = {};
      relsByTypeResult.rows.forEach(row => {
        relationshipsByType[row[0]] = row[1];
      });

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

}

