/**
 * KuzuDB Schema Definitions for GitNexus
 * 
 * This module contains the complete schema definitions for the KuzuDB
 * implementation, including all node tables, relationship tables, and
 * migration utilities for converting from the existing JSON format.
 */

import type { NodeLabel, RelationshipType } from '../graph/types.ts';
import type { KuzuInstance, NodeSchema, RelationshipSchema } from './kuzu-loader.ts';

/**
 * Complete node table definitions for GitNexus knowledge graph
 */
export const NODE_TABLE_SCHEMAS: Record<NodeLabel, NodeSchema> = {
  Project: {
    id: 'STRING',
    name: 'STRING',
    path: 'STRING',
    description: 'STRING',
    version: 'STRING',
    createdAt: 'STRING'
  },

  Folder: {
    id: 'STRING',
    name: 'STRING',
    path: 'STRING',
    fullPath: 'STRING',
    depth: 'INT64'
  },

  File: {
    id: 'STRING',
    name: 'STRING',
    path: 'STRING',
    filePath: 'STRING',
    extension: 'STRING',
    language: 'STRING',
    size: 'INT64',
    definitionCount: 'INT64',
    lineCount: 'INT64'
  },

  Function: {
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
    parentClass: 'STRING',
    docstring: 'STRING'
  },

  Class: {
    id: 'STRING',
    name: 'STRING',
    filePath: 'STRING',
    startLine: 'INT64',
    endLine: 'INT64',
    qualifiedName: 'STRING',
    accessibility: 'STRING',
    isAbstract: 'BOOLEAN',
    extends: 'STRING[]',
    implements: 'STRING[]',
    docstring: 'STRING'
  },

  Method: {
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
    parentClass: 'STRING',
    docstring: 'STRING'
  },

  Variable: {
    id: 'STRING',
    name: 'STRING',
    filePath: 'STRING',
    startLine: 'INT64',
    endLine: 'INT64',
    type: 'STRING',
    accessibility: 'STRING',
    isStatic: 'BOOLEAN'
  },

  Interface: {
    id: 'STRING',
    name: 'STRING',
    filePath: 'STRING',
    startLine: 'INT64',
    endLine: 'INT64',
    qualifiedName: 'STRING',
    extends: 'STRING[]',
    docstring: 'STRING'
  },

  Type: {
    id: 'STRING',
    name: 'STRING',
    filePath: 'STRING',
    startLine: 'INT64',
    endLine: 'INT64',
    qualifiedName: 'STRING',
    typeDefinition: 'STRING',
    docstring: 'STRING'
  },

  Decorator: {
    id: 'STRING',
    name: 'STRING',
    filePath: 'STRING',
    startLine: 'INT64',
    endLine: 'INT64',
    targetType: 'STRING',
    arguments: 'STRING[]'
  },

  Import: {
    id: 'STRING',
    name: 'STRING',
    filePath: 'STRING',
    type: 'STRING',
    startLine: 'INT64',
    endLine: 'INT64',
    parameters: 'STRING[]',
    returnType: 'STRING',
    accessibility: 'STRING',
    isStatic: 'BOOLEAN',
    isAsync: 'BOOLEAN',
    parentClass: 'STRING',
    decorators: 'STRING[]',
    extends: 'STRING[]',
    implements: 'STRING[]',
    importPath: 'STRING',
    exportType: 'STRING',
    docstring: 'STRING'
  },

  CodeElement: {
    id: 'STRING',
    name: 'STRING',
    filePath: 'STRING',
    startLine: 'INT64',
    endLine: 'INT64',
    elementType: 'STRING'
  },

  Package: {
    id: 'STRING',
    name: 'STRING',
    path: 'STRING',
    version: 'STRING',
    description: 'STRING'
  },

  Module: {
    id: 'STRING',
    name: 'STRING',
    path: 'STRING',
    filePath: 'STRING',
    language: 'STRING',
    exports: 'STRING[]'
  },

  Enum: {
    id: 'STRING',
    name: 'STRING',
    filePath: 'STRING',
    startLine: 'INT64',
    endLine: 'INT64',
    qualifiedName: 'STRING',
    values: 'STRING[]'
  }
};

/**
 * Relationship table definitions with their allowed node connections
 */
export interface RelationshipTableDefinition {
  name: RelationshipType;
  connections: Array<{
    from: NodeLabel;
    to: NodeLabel;
  }>;
  schema: RelationshipSchema;
}

export const RELATIONSHIP_TABLE_SCHEMAS: RelationshipTableDefinition[] = [
  {
    name: 'CONTAINS',
    connections: [
      { from: 'Project', to: 'Folder' },
      { from: 'Project', to: 'File' },
      { from: 'Folder', to: 'Folder' },
      { from: 'Folder', to: 'File' },
      { from: 'File', to: 'Function' },
      { from: 'File', to: 'Class' },
      { from: 'File', to: 'Variable' },
      { from: 'File', to: 'Interface' },
      { from: 'File', to: 'Type' },
      { from: 'File', to: 'Import' },
      { from: 'Class', to: 'Method' },
      { from: 'Class', to: 'Variable' }
    ],
    schema: {
      // CONTAINS relationships have no properties - they're purely structural
    }
  },

  {
    name: 'CALLS',
    connections: [
      { from: 'Function', to: 'Function' },
      { from: 'Method', to: 'Function' },
      { from: 'Method', to: 'Method' },
      { from: 'Function', to: 'Method' }
    ],
    schema: {
      callType: 'STRING',
      functionName: 'STRING',
      startLine: 'INT64',
      endLine: 'INT64'
    }
  },

  {
    name: 'INHERITS',
    connections: [
      { from: 'Class', to: 'Class' }
    ],
    schema: {
      inheritanceType: 'STRING'
    }
  },

  {
    name: 'OVERRIDES',
    connections: [
      { from: 'Method', to: 'Method' }
    ],
    schema: {
      overrideType: 'STRING'
    }
  },

  {
    name: 'IMPORTS',
    connections: [
      { from: 'File', to: 'File' }
    ],
    schema: {
      importType: 'STRING',
      localName: 'STRING',
      exportedName: 'STRING'
    }
  },

  {
    name: 'IMPLEMENTS',
    connections: [
      { from: 'Class', to: 'Interface' }
    ],
    schema: {
      implementationType: 'STRING'
    }
  },

  {
    name: 'DECORATES',
    connections: [
      { from: 'Decorator', to: 'Function' },
      { from: 'Decorator', to: 'Class' },
      { from: 'Decorator', to: 'Method' }
    ],
    schema: {
      decoratorType: 'STRING',
      arguments: 'STRING[]'
    }
  },

  {
    name: 'DEFINES',
    connections: [
      { from: 'File', to: 'Function' },
      { from: 'File', to: 'Class' },
      { from: 'File', to: 'Method' },
      { from: 'File', to: 'Variable' },
      { from: 'File', to: 'Interface' },
      { from: 'File', to: 'Type' },
      { from: 'File', to: 'Decorator' },
      { from: 'File', to: 'Import' },
      { from: 'Class', to: 'Method' },
      { from: 'Class', to: 'Variable' }
    ],
    schema: {
      filePath: 'STRING',
      line_number: 'INT64'
    }
  },

  {
    name: 'BELONGS_TO',
    connections: [
      { from: 'Method', to: 'Class' },
      { from: 'Variable', to: 'Class' },
      { from: 'Function', to: 'Class' }
    ],
    schema: {
      parentType: 'STRING'
    }
  },

  {
    name: 'USES',
    connections: [
      { from: 'Function', to: 'Variable' },
      { from: 'Method', to: 'Variable' },
      { from: 'Class', to: 'Interface' },
      { from: 'Function', to: 'Type' },
      { from: 'Method', to: 'Type' }
    ],
    schema: {
      usageType: 'STRING',
      context: 'STRING'
    }
  },

  {
    name: 'ACCESSES',
    connections: [
      { from: 'Function', to: 'Variable' },
      { from: 'Method', to: 'Variable' }
    ],
    schema: {
      accessType: 'STRING',
      line_number: 'INT64'
    }
  },

  {
    name: 'EXTENDS',
    connections: [
      { from: 'Class', to: 'Class' },
      { from: 'Interface', to: 'Interface' }
    ],
    schema: {
      extensionType: 'STRING'
    }
  }
];

/**
 * Index definitions for optimizing common queries
 */
export interface IndexDefinition {
  table: string;
  column: string;
  type: 'PRIMARY' | 'SECONDARY';
}

export const INDEX_DEFINITIONS: IndexDefinition[] = [
  // Primary keys (already handled in table creation)
  { table: 'Project', column: 'id', type: 'PRIMARY' },
  { table: 'Folder', column: 'id', type: 'PRIMARY' },
  { table: 'File', column: 'id', type: 'PRIMARY' },
  { table: 'Function', column: 'id', type: 'PRIMARY' },
  { table: 'Class', column: 'id', type: 'PRIMARY' },
  { table: 'Method', column: 'id', type: 'PRIMARY' },
  { table: 'Variable', column: 'id', type: 'PRIMARY' },
  { table: 'Interface', column: 'id', type: 'PRIMARY' },
  { table: 'Type', column: 'id', type: 'PRIMARY' },
  { table: 'Decorator', column: 'id', type: 'PRIMARY' },
  { table: 'Import', column: 'id', type: 'PRIMARY' },
  { table: 'CodeElement', column: 'id', type: 'PRIMARY' },

  // Secondary indexes for common queries
  { table: 'Function', column: 'name', type: 'SECONDARY' },
  { table: 'Function', column: 'filePath', type: 'SECONDARY' },
  { table: 'Class', column: 'name', type: 'SECONDARY' },
  { table: 'Class', column: 'qualifiedName', type: 'SECONDARY' },
  { table: 'File', column: 'filePath', type: 'SECONDARY' },
  { table: 'File', column: 'language', type: 'SECONDARY' },
  { table: 'Method', column: 'parentClass', type: 'SECONDARY' },
  { table: 'Variable', column: 'type', type: 'SECONDARY' }
];

/**
 * Schema manager for KuzuDB initialization and migration
 */
export class KuzuSchemaManager {
  private kuzuInstance: KuzuInstance;

  constructor(kuzuInstance: KuzuInstance) {
    this.kuzuInstance = kuzuInstance;
  }

  /**
   * Initialize the complete schema in KuzuDB
   */
  async initializeSchema(): Promise<void> {
    console.log('🏗️ Initializing KuzuDB schema...');

    try {
      // Create all node tables
      await this.createNodeTables();

      // Create all relationship tables
      await this.createRelationshipTables();

      // Create indexes (if supported by KuzuDB)
      await this.createIndexes();

      console.log('✅ Schema initialization completed successfully');
    } catch (error) {
      console.error('❌ Schema initialization failed:', error);
      throw new Error(`Schema initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create all node tables
   */
  private async createNodeTables(): Promise<void> {
    console.log('📋 Creating node tables...');

    for (const [tableName, schema] of Object.entries(NODE_TABLE_SCHEMAS)) {
      try {
        await this.kuzuInstance.createNodeTable(tableName, schema);
        console.log(`✅ Created node table: ${tableName}`);
      } catch (error) {
        // Table might already exist
        console.log(`ℹ️ Node table ${tableName} might already exist: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  /**
   * Create all relationship tables
   */
  private async createRelationshipTables(): Promise<void> {
    console.log('🔗 Creating relationship tables...');

    for (const relDef of RELATIONSHIP_TABLE_SCHEMAS) {
      console.log(`📋 Creating relationship table: ${relDef.name} with ${relDef.connections.length} connections`);
      
      // Create relationship table for each FROM-TO combination
      // KuzuDB may require separate tables for different node type combinations
      for (let i = 0; i < relDef.connections.length; i++) {
        const connection = relDef.connections[i];
        
        try {
          await this.kuzuInstance.createRelTable(
            relDef.name,
            connection.from,
            connection.to,
            relDef.schema
          );
          
          console.log(`✅ Created relationship table: ${relDef.name} (${connection.from} -> ${connection.to})`);
          
          // For KuzuDB, we might only need to create the table once
          // and it will handle multiple node type combinations automatically
          // Break after first successful creation to avoid duplicates
          break;
          
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          
          // If this is the last connection and all failed, log as warning
          if (i === relDef.connections.length - 1) {
            console.warn(`⚠️ Failed to create relationship table ${relDef.name} for all connections: ${errorMsg}`);
          } else {
            console.log(`ℹ️ Failed to create ${relDef.name} (${connection.from} -> ${connection.to}): ${errorMsg}, trying next connection...`);
          }
        }
      }
    }
  }

  /**
   * Create indexes for query optimization
   */
  private async createIndexes(): Promise<void> {
    console.log('🔍 Creating indexes...');

    // Note: Index creation syntax depends on KuzuDB's specific implementation
    // This is a placeholder for when KuzuDB supports explicit index creation
    for (const indexDef of INDEX_DEFINITIONS) {
      if (indexDef.type === 'SECONDARY') {
        try {
          // Placeholder for index creation
          // const cypher = `CREATE INDEX ON ${indexDef.table}(${indexDef.column})`;
          // await this.kuzuInstance.executeQuery(cypher);
          console.log(`ℹ️ Index on ${indexDef.table}.${indexDef.column} (placeholder)`);
        } catch (error) {
          console.log(`ℹ️ Failed to create index on ${indexDef.table}.${indexDef.column}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }
  }

  /**
   * Validate that all required tables exist
   */
  async validateSchema(): Promise<{
    isValid: boolean;
    missingTables: string[];
    errors: string[];
  }> {
    console.log('🔍 Validating schema...');

    const missingTables: string[] = [];
    const errors: string[] = [];

    try {
      // Get list of existing tables
      const tablesResult = await this.kuzuInstance.executeQuery('CALL show_tables() RETURN *');
      const existingTables = new Set(
        tablesResult.rows.map(row => row[0]).filter(name => typeof name === 'string')
      );

      // Check node tables
      for (const tableName of Object.keys(NODE_TABLE_SCHEMAS)) {
        if (!existingTables.has(tableName)) {
          missingTables.push(tableName);
        }
      }

      // Check relationship tables
      for (const relDef of RELATIONSHIP_TABLE_SCHEMAS) {
        if (!existingTables.has(relDef.name)) {
          missingTables.push(relDef.name);
        }
      }

      const isValid = missingTables.length === 0 && errors.length === 0;

      console.log(isValid ? '✅ Schema validation passed' : '❌ Schema validation failed');

      return {
        isValid,
        missingTables,
        errors
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown validation error';
      errors.push(errorMessage);
      console.error('❌ Schema validation error:', errorMessage);

      return {
        isValid: false,
        missingTables,
        errors
      };
    }
  }

  /**
   * Drop all tables (use with caution!)
   */
  async dropAllTables(): Promise<void> {
    console.log('⚠️ Dropping all tables...');

    try {
      // Drop relationship tables first (due to foreign key constraints)
      for (const relDef of RELATIONSHIP_TABLE_SCHEMAS) {
        try {
          await this.kuzuInstance.executeQuery(`DROP TABLE ${relDef.name}`);
          console.log(`✅ Dropped relationship table: ${relDef.name}`);
        } catch (error) {
          console.log(`ℹ️ Could not drop relationship table ${relDef.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      // Drop node tables
      for (const tableName of Object.keys(NODE_TABLE_SCHEMAS)) {
        try {
          await this.kuzuInstance.executeQuery(`DROP TABLE ${tableName}`);
          console.log(`✅ Dropped node table: ${tableName}`);
        } catch (error) {
          console.log(`ℹ️ Could not drop node table ${tableName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      console.log('✅ All tables dropped');
    } catch (error) {
      console.error('❌ Failed to drop tables:', error);
      throw error;
    }
  }

  /**
   * Get schema information
   */
  async getSchemaInfo(): Promise<{
    nodeTables: Array<{ name: string; columnCount: number }>;
    relationshipTables: Array<{ name: string; columnCount: number }>;
    totalTables: number;
  }> {
    try {
      const tablesResult = await this.kuzuInstance.executeQuery('CALL show_tables() RETURN *');
      
      const nodeTables: Array<{ name: string; columnCount: number }> = [];
      const relationshipTables: Array<{ name: string; columnCount: number }> = [];

      for (const row of tablesResult.rows) {
        const tableName = row[0];
        const tableType = row[1] || '';
        
        if (typeof tableName === 'string') {
          const columnCount = Object.keys(NODE_TABLE_SCHEMAS[tableName as NodeLabel] || {}).length;
          
          if (tableType.includes('NODE') || Object.keys(NODE_TABLE_SCHEMAS).includes(tableName)) {
            nodeTables.push({ name: tableName, columnCount });
          } else if (tableType.includes('REL') || RELATIONSHIP_TABLE_SCHEMAS.some(r => r.name === tableName)) {
            relationshipTables.push({ name: tableName, columnCount });
          }
        }
      }

      return {
        nodeTables,
        relationshipTables,
        totalTables: nodeTables.length + relationshipTables.length
      };
    } catch (error) {
      console.error('Failed to get schema info:', error);
      return {
        nodeTables: [],
        relationshipTables: [],
        totalTables: 0
      };
    }
  }

  /**
   * Recreate a specific node table (for auto-recovery)
   */
  async recreateNodeTable(nodeLabel: NodeLabel): Promise<void> {
    try {
      console.log(`🔧 Recreating node table: ${nodeLabel}`);
      
      // Drop table if it exists (ignore errors)
      try {
        await this.kuzuInstance.executeQuery(`DROP TABLE ${nodeLabel}`);
      } catch (error) {
        // Ignore drop errors - table might not exist
      }
      
      // Create the table
      const schema = NODE_TABLE_SCHEMAS[nodeLabel];
      if (!schema) {
        throw new Error(`No schema found for node label: ${nodeLabel}`);
      }
      
      await this.kuzuInstance.createNodeTable(nodeLabel, schema);
      console.log(`✅ Successfully recreated node table: ${nodeLabel}`);
      
    } catch (error) {
      console.error(`❌ Failed to recreate node table ${nodeLabel}:`, error);
      throw error;
    }
  }

  /**
   * Recreate a specific relationship table (for auto-recovery)
   */
  async recreateRelationshipTable(relationshipType: RelationshipType): Promise<void> {
    try {
      console.log(`🔧 Recreating relationship table: ${relationshipType}`);
      
      // Drop table if it exists (ignore errors)
      try {
        await this.kuzuInstance.executeQuery(`DROP TABLE ${relationshipType}`);
      } catch (error) {
        // Ignore drop errors - table might not exist
      }
      
      // Find the relationship definition
      const relDef = RELATIONSHIP_TABLE_SCHEMAS.find(def => def.name === relationshipType);
      if (!relDef) {
        throw new Error(`No schema found for relationship type: ${relationshipType}`);
      }
      
      // Create the relationship table for each connection
      for (const connection of relDef.connections) {
        try {
          await this.kuzuInstance.createRelTable(
            relationshipType,
            connection.from,
            connection.to,
            relDef.schema
          );
          console.log(`✅ Created relationship table ${relationshipType} (${connection.from} -> ${connection.to})`);
          break; // Only need to create once
        } catch (error) {
          console.warn(`⚠️ Failed to create ${relationshipType} table for ${connection.from} -> ${connection.to}:`, error);
        }
      }
      
      console.log(`✅ Successfully recreated relationship table: ${relationshipType}`);
      
    } catch (error) {
      console.error(`❌ Failed to recreate relationship table ${relationshipType}:`, error);
      throw error;
    }
  }
}

/**
 * Utility function to get the schema for a specific node label
 */
export function getNodeSchema(label: NodeLabel): NodeSchema | undefined {
  return NODE_TABLE_SCHEMAS[label];
}

/**
 * Utility function to get relationship definitions for a specific type
 */
export function getRelationshipDefinition(type: RelationshipType): RelationshipTableDefinition | undefined {
  return RELATIONSHIP_TABLE_SCHEMAS.find(def => def.name === type);
}

/**
 * Utility function to validate if a relationship connection is allowed
 */
export function isValidRelationshipConnection(
  type: RelationshipType,
  fromLabel: NodeLabel,
  toLabel: NodeLabel
): boolean {
  const relDef = getRelationshipDefinition(type);
  if (!relDef) return false;

  return relDef.connections.some(
    conn => conn.from === fromLabel && conn.to === toLabel
  );
}

/**
 * Get all possible node labels
 */
export function getAllNodeLabels(): NodeLabel[] {
  return Object.keys(NODE_TABLE_SCHEMAS) as NodeLabel[];
}

/**
 * Get all possible relationship types
 */
export function getAllRelationshipTypes(): RelationshipType[] {
  return RELATIONSHIP_TABLE_SCHEMAS.map(def => def.name);
}

