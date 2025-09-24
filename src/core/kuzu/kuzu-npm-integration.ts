/**
 * KuzuDB NPM Package Integration
 * 
 * This module integrates with the official kuzu-wasm npm package
 * to provide KuzuDB functionality in the browser.
 */

import type { DatabaseInfo, QueryResult, NodeSchema, RelationshipSchema, KuzuInstance } from './kuzu-loader.ts';

let kuzuModule: any = null;
let database: any = null;
let connection: any = null;
let isInitialized = false;

/**
 * Initialize KuzuDB using the npm package
 */
export async function initKuzuNPM(): Promise<KuzuInstance> {
  if (isInitialized && database && connection) {
    return createKuzuInstance();
  }

  try {
    console.log('🚀 Loading KuzuDB from npm package...');
    
    // Dynamic import of the kuzu-wasm package
    kuzuModule = await import('kuzu-wasm');
    console.log('✅ KuzuDB npm package loaded');
    
    // Initialize the module first
    console.log('🔧 Initializing KuzuDB module...');
    await kuzuModule.default.init();
    console.log('✅ KuzuDB module initialized');
    
    // Create database instance (in-memory for browser)
    const dbPath = ':memory:';
    console.log(`🗃️ Creating KuzuDB database: ${dbPath}`);
    database = new kuzuModule.default.Database(dbPath);
    console.log('✅ KuzuDB database created');
    
    // Create connection
    console.log('🔗 Creating KuzuDB connection...');
    connection = new kuzuModule.default.Connection(database);
    console.log('✅ KuzuDB connection established');
    
    isInitialized = true;
    console.log('🎉 KuzuDB npm integration initialized successfully!');
    
    return createKuzuInstance();
    
  } catch (error) {
    console.error('❌ Failed to initialize KuzuDB from npm package:', error);
    throw new Error(`KuzuDB npm initialization failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Create a KuzuInstance wrapper around the npm package
 */
function createKuzuInstance(): KuzuInstance {
  if (!database || !connection) {
    throw new Error('KuzuDB not initialized');
  }

  return {
    async createDatabase(path: string): Promise<void> {
      console.log(`Database already created at: ${path}`);
      // Database is already created during initialization
    },
    
    async closeDatabase(): Promise<void> {
      console.log('🔒 Closing KuzuDB database...');
      if (connection) {
        connection.close();
        connection = null;
      }
      if (database) {
        database.close();
        database = null;
      }
      isInitialized = false;
      console.log('✅ KuzuDB database closed');
    },
    
    async createNodeTable(tableName: string, schema: NodeSchema): Promise<void> {
      console.log(`📋 Creating node table: ${tableName}`);
      
      // Convert schema to CREATE TABLE statement
      const columns = Object.entries(schema)
        .map(([name, type]) => `${name} ${type}`)
        .join(', ');
      
      const query = `CREATE NODE TABLE ${tableName}(${columns}, PRIMARY KEY (id));`;
      console.log(`🔧 Executing: ${query}`);
      
      await connection.query(query);
      console.log(`✅ Node table ${tableName} created`);
    },
    
    async createRelTable(
      tableName: string, 
      fromTable: string, 
      toTable: string, 
      schema?: RelationshipSchema
    ): Promise<void> {
      console.log(`🔗 Creating relationship table: ${tableName} (${fromTable} -> ${toTable})`);
      
      // Build CREATE REL TABLE statement with correct KuzuDB syntax
      const columns = schema && Object.keys(schema).length > 0 
        ? ', ' + Object.entries(schema)
            .map(([name, type]) => `${name} ${type}`)
            .join(', ')
        : '';
      
      const query = `CREATE REL TABLE ${tableName}(FROM ${fromTable} TO ${toTable}${columns});`;
      
      console.log(`🔧 Executing: ${query}`);
      
      await connection.query(query);
      console.log(`✅ Relationship table ${tableName} created`);
    },
    
    async insertNode(tableName: string, data: Record<string, any>): Promise<void> {
      const properties = Object.entries(data)
        .map(([key, value]) => `${key}: ${formatValue(value)}`)
        .join(', ');
      
      const query = `CREATE (n:${tableName} {${properties}});`;
      await connection.query(query);
    },
    
    async insertRel(
      tableName: string, 
      source: string, 
      target: string, 
      data: Record<string, any>
    ): Promise<void> {
      const properties = Object.keys(data).length > 0 
        ? `{${Object.entries(data).map(([k, v]) => `${k}: ${formatValue(v)}`).join(', ')}}`
        : '';
      
      const query = `MATCH (a {id: ${formatValue(source)}}), (b {id: ${formatValue(target)}}) CREATE (a)-[:${tableName} ${properties}]->(b);`;
      await connection.query(query);
    },
    
    async executeQuery(cypher: string): Promise<QueryResult> {
      // Trim long queries for cleaner logs
      const trimmedQuery = cypher.length > 100 ? cypher.substring(0, 100) + '...' : cypher;
      console.log(`🔍 Executing query: ${trimmedQuery}`);
      
      try {
        const result = await connection.query(cypher);
        
        // Check if query was successful
        if (!result.isSuccess()) {
          throw new Error(`Query failed: ${result.getErrorMessage()}`);
        }
        
        // Extract data from kuzu-wasm result
        const columns = result.getColumnNames();
        const rawRows = await result.getAllRows(); // Get all rows at once (async)
        const rowCount = await result.getNumTuples(); // This might be async too
        
        // Convert BigInt values to strings to avoid serialization issues
        const rows = rawRows.map(row => 
          row.map(cell => {
            if (typeof cell === 'bigint') {
              return cell.toString();
            }
            return cell;
          })
        );
        
        const queryResult: QueryResult = {
          columns,
          rows,
          rowCount: typeof rowCount === 'bigint' ? Number(rowCount) : rowCount,
          executionTime: 0 // TODO: Add timing if available
        };
        
        // Close the result
        result.close();
        
        console.log(`✅ Query completed: ${rowCount} rows returned`);
        return queryResult;
        
      } catch (error) {
        console.error(`❌ Query failed: ${error}`);
        throw error;
      }
    },
    
    async getDatabaseInfo(): Promise<DatabaseInfo> {
      try {
        // Get basic database statistics
        const nodeCountResult = await connection.query('MATCH (n) RETURN count(n) as nodeCount');
        const relCountResult = await connection.query('MATCH ()-[r]->() RETURN count(r) as relCount');
        
        let nodeCount = 0;
        let relCount = 0;
        
        if (nodeCountResult.isSuccess() && nodeCountResult.getNumTuples() > 0) {
          const rows = nodeCountResult.getAllRows();
          nodeCount = rows[0]?.[0] || 0;
        }
        nodeCountResult.close();
        
        if (relCountResult.isSuccess() && relCountResult.getNumTuples() > 0) {
          const rows = relCountResult.getAllRows();
          relCount = rows[0]?.[0] || 0;
        }
        relCountResult.close();
        
        return {
          version: kuzuModule?.default?.getVersion?.() || '0.11.1',
          nodeTableCount: 0, // TODO: Get actual table counts
          relationshipTableCount: 0, // TODO: Get actual table counts
          totalNodes: nodeCount,
          totalRelationships: relCount
        };
      } catch (error) {
        console.warn('Could not get database info, returning defaults:', error);
        return {
          version: '0.11.1',
          nodeTableCount: 0,
          relationshipTableCount: 0,
          totalNodes: 0,
          totalRelationships: 0
        };
      }
    },
    
    isReady(): boolean {
      return isInitialized && !!database && !!connection;
    },
    
    getDatabasePath(): string {
      return ':memory:';
    },
    
    getFS(): any {
      if (!kuzuModule || !kuzuModule.default || !kuzuModule.default.FS) {
        throw new Error('KuzuDB FS API not available');
      }
      return kuzuModule.default.FS;
    }
  };
}

/**
 * Format a value for use in Cypher queries
 */
function formatValue(value: any): string {
  if (value === null || value === undefined) {
    return 'null';
  } else if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  } else if (typeof value === 'number') {
    return String(value);
  } else if (Array.isArray(value)) {
    return `[${value.map(v => formatValue(v)).join(', ')}]`;
  } else {
    return `'${String(value).replace(/'/g, "\\'")}'`;
  }
}

/**
 * Check if KuzuDB npm package is available
 */
export function isKuzuNPMAvailable(): boolean {
  try {
    return typeof WebAssembly === 'object' && 
           typeof WebAssembly.instantiate === 'function';
  } catch (e) {
    return false;
  }
}

/**
 * Clean up KuzuDB resources
 */
export async function closeKuzuNPM(): Promise<void> {
  if (connection) {
    connection.close();
    connection = null;
  }
  if (database) {
    database.close();
    database = null;
  }
  isInitialized = false;
  console.log('🔒 KuzuDB npm integration closed');
}
