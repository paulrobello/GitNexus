/**
 * GitNexus CSV Generator for KuzuDB COPY Operations
 * 
 * This service converts GitNexus graph data (nodes and relationships) into
 * CSV format compatible with KuzuDB COPY statements. It handles polymorphic
 * data structures, schema-aware column mapping, and proper CSV escaping.
 * 
 * DESIGN DECISION: Only schema-defined columns are included in COPY operations
 * to ensure exact column count matching. Dynamic properties are ignored during
 * COPY and will be handled by fallback MERGE operations if needed.
 */

import type { GraphNode, GraphRelationship, NodeLabel, RelationshipType } from '../graph/types.ts';
import { NODE_TABLE_SCHEMAS, RELATIONSHIP_TABLE_SCHEMAS } from './kuzu-schema.ts';

export class GitNexusCSVGenerator {
  private static readonly CSV_ESCAPE_REGEX = /[",\r\n]/;
  private static readonly QUOTE_ESCAPE_REGEX = /"/g;
  
  /**
   * Generate CSV for nodes of specific label with schema-aware column mapping
   */
  static generateNodeCSV(nodes: GraphNode[], label: NodeLabel): string {
    const filteredNodes = nodes.filter(node => node.label === label);
    if (filteredNodes.length === 0) return '';
    
    // Get schema-defined columns for this node type
    const schemaColumns = this.getSchemaColumnsForLabel(label);
    // For COPY operations, only use schema-defined columns to avoid column mismatch
    const allColumns = ['id', ...schemaColumns];
    
    // Generate header
    const header = allColumns.join(',');
    
    // Generate rows with proper type conversion
    const rows = filteredNodes.map((node, index) => {
      const rowValues = allColumns.map((col, colIndex) => {
        let value = col === 'id' ? node.id : node.properties[col];
        
        // Apply default values for missing schema properties
        if (value === undefined && col !== 'id') {
          value = this.getDefaultValueForColumn(col, label);
        }
        
        const formattedValue = this.formatValueForCSV(value, col, label);
        
        // Debug: Check Function nodes and docstring column specifically (can be removed after verification)
        // if (label === 'Function' && (col === 'docstring' || col === 'parentClass')) {
        //   console.log(`   🔍 Function ${node.id} - Column ${colIndex} (${col}): value="${value}" -> formatted="${formattedValue}"`);
        // }
        
        return formattedValue;
      });
      
      // Ensure we have exactly the right number of values
      while (rowValues.length < allColumns.length) {
        rowValues.push(''); // Add empty string for missing values
      }
      
      let csvRow = rowValues.join(',');
      
      // CRITICAL FIX: Ensure we have the right number of commas for empty trailing values
      const expectedCommas = allColumns.length - 1;
      const actualCommas = (csvRow.match(/,/g) || []).length;
      
      // Debug for problematic function
      if (node.id === 'function_c2f7f72a') {
        console.log(`🔧 Comma analysis for ${node.id}:`);
        console.log(`   Expected commas: ${expectedCommas}`);
        console.log(`   Actual commas: ${actualCommas}`);
        console.log(`   Row before fix: "${csvRow}"`);
        console.log(`   Row ends with: "${csvRow.slice(-5)}"`);
        console.log(`   Row char codes: [${csvRow.slice(-5).split('').map(c => c.charCodeAt(0)).join(', ')}]`);
      }
      
      if (actualCommas < expectedCommas) {
        const missingCommas = expectedCommas - actualCommas;
        csvRow += ','.repeat(missingCommas);
        console.log(`🔧 Fixed missing ${missingCommas} trailing comma(s) for ${node.id}`);
        
        if (node.id === 'function_c2f7f72a') {
          console.log(`   Row after fix: "${csvRow}"`);
          console.log(`   New comma count: ${(csvRow.match(/,/g) || []).length}`);
        }
      }
      
      
      return csvRow;
    });
    
    const csv = [header, ...rows].join('\n');
    return csv;
  }
  
  /**
   * Generate CSV for relationships with polymorphic property handling
   */
  static generateRelationshipCSV(relationships: GraphRelationship[], type: RelationshipType): string {
    const filteredRels = relationships.filter(rel => rel.type === type);
    if (filteredRels.length === 0) return '';
    
    // Base columns for all relationships
    const baseColumns = ['source', 'target'];
    const schemaColumns = this.getSchemaColumnsForRelType(type);
    // For COPY operations, only use schema-defined columns to avoid column mismatch
    const allColumns = [...baseColumns, ...schemaColumns];
    
    const header = allColumns.join(',');
    
    const rows = filteredRels.map(rel => {
      return allColumns.map(col => {
        let value: any;
        if (col === 'source') value = rel.source;
        else if (col === 'target') value = rel.target;
        else value = rel.properties[col];
        
        return this.formatValueForCSV(value, col, type);
      }).join(',');
    });
    
    const csv = [header, ...rows].join('\n');
    return csv;
  }
  
  /**
   * Schema-aware value formatting with type conversion
   */
  private static formatValueForCSV(value: any, column: string, entityType: NodeLabel | RelationshipType): string {
    if (value === null || value === undefined) return '';
    
    // Handle empty strings
    if (value === '') return '';
    
    // Handle arrays (convert to JSON string for KuzuDB STRING[] compatibility)
    if (Array.isArray(value)) {
      // For KuzuDB STRING[] columns, format as JSON array
      const arrayStr = JSON.stringify(value);
      return this.escapeCSVValue(arrayStr);
    }
    
    // Handle objects (convert to JSON string)
    if (typeof value === 'object') {
      const objStr = JSON.stringify(value);
      return this.escapeCSVValue(objStr);
    }
    
    // Handle booleans (KuzuDB BOOLEAN type)
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    
    // Handle numbers (KuzuDB INT64/DOUBLE types)
    if (typeof value === 'number') {
      return String(value);
    }
    
    // Handle strings (KuzuDB STRING type)
    const str = String(value);
    return this.escapeCSVValue(str);
  }
  
  /**
   * Proper CSV escaping according to RFC 4180
   */
  private static escapeCSVValue(str: string): string {
    if (!this.CSV_ESCAPE_REGEX.test(str)) {
      return str;
    }
    
    // Escape quotes by doubling them and wrap in quotes
    const escaped = str.replace(this.QUOTE_ESCAPE_REGEX, '""');
    return `"${escaped}"`;
  }
  
  /**
   * Get schema-defined columns for node label (excluding 'id' which is handled separately)
   */
  private static getSchemaColumnsForLabel(label: NodeLabel): string[] {
    const schema = NODE_TABLE_SCHEMAS[label];
    return schema ? Object.keys(schema).filter(col => col !== 'id') : [];
  }
  
  /**
   * Get default value for missing schema columns
   */
  private static getDefaultValueForColumn(column: string, label: NodeLabel): any {
    // Get the schema type for this column
    const schema = NODE_TABLE_SCHEMAS[label];
    if (!schema || !schema[column]) {
      return ''; // Empty string for unknown columns
    }
    
    const columnType = schema[column];
    
    // Return appropriate default values based on KuzuDB type
    switch (columnType) {
      case 'STRING':
        // Special defaults for known File properties
        if (column === 'language') return 'unknown';
        if (column === 'extension') return '';
        return '';
        
      case 'INT64':
        // Special defaults for known File properties
        if (column === 'size') return 0;
        if (column === 'definitionCount') return 0;
        if (column === 'lineCount') return 0;
        if (column === 'startLine') return 0;
        if (column === 'endLine') return 0;
        return 0;
        
      case 'DOUBLE':
        return 0.0;
        
      case 'BOOLEAN':
        return false;
        
      case 'STRING[]':
        return []; // Empty array
        
      default:
        return '';
    }
  }
  
  /**
   * Get schema-defined columns for relationship type  
   */
  private static getSchemaColumnsForRelType(type: RelationshipType): string[] {
    const relDef = RELATIONSHIP_TABLE_SCHEMAS.find(def => def.name === type);
    return relDef ? Object.keys(relDef.schema) : [];
  }
  
  // Note: Dynamic column extraction removed for COPY operations
  // COPY requires exact schema match. Dynamic properties will be handled
  // by fallback MERGE operations if needed.
  
  /**
   * Validate CSV data format before COPY operation
   */
  static validateCSVFormat(csvData: string): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!csvData || csvData.trim().length === 0) {
      errors.push('CSV data is empty');
      return { isValid: false, errors };
    }
    
    const lines = csvData.split('\n');
    if (lines.length < 2) {
      errors.push('CSV must have at least header and one data row');
      return { isValid: false, errors };
    }
    
    const headerColumns = this.parseCSVLine(lines[0]).length;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.length === 0) continue; // Skip empty lines
      
      const columns = this.parseCSVLine(line).length;
      if (columns !== headerColumns) {
        errors.push(`Row ${i + 1} has ${columns} columns, expected ${headerColumns}`);
      }
    }
    
    return { isValid: errors.length === 0, errors };
  }
  
  /**
   * Parse a CSV line respecting quoted values
   */
  private static parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          // Escaped quote
          current += '"';
          i++; // Skip next quote
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        // End of field
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    
    // Add the last field
    result.push(current);
    
    return result;
  }
  
  /**
   * Get estimated CSV size for memory planning
   */
  static estimateCSVSize(nodes: GraphNode[]): number {
    if (nodes.length === 0) return 0;
    
    // Estimate based on first node
    const sampleNode = nodes[0];
    const sampleSize = JSON.stringify(sampleNode).length;
    
    // CSV overhead factor (headers, escaping, etc.)
    const csvOverhead = 1.3;
    
    return Math.ceil(sampleSize * nodes.length * csvOverhead);
  }
  
  /**
   * Generate CSV in chunks for large datasets to avoid memory issues
   */
  static generateNodeCSVInChunks(nodes: GraphNode[], label: NodeLabel, chunkSize: number = 1000): string {
    if (nodes.length <= chunkSize) {
      return this.generateNodeCSV(nodes, label);
    }
    
    console.log(`📝 Generating CSV for ${nodes.length} ${label} nodes in chunks of ${chunkSize}`);
    
    const chunks: string[] = [];
    let header: string | null = null;
    
    for (let i = 0; i < nodes.length; i += chunkSize) {
      const chunk = nodes.slice(i, i + chunkSize);
      const csvChunk = this.generateNodeCSV(chunk, label);
      
      if (!csvChunk) continue;
      
      const lines = csvChunk.split('\n');
      
      if (header === null) {
        // First chunk - include header
        header = lines[0];
        chunks.push(csvChunk);
      } else {
        // Subsequent chunks - skip header
        const dataLines = lines.slice(1);
        if (dataLines.length > 0) {
          chunks.push(dataLines.join('\n'));
        }
      }
    }
    
    const result = chunks.join('\n');
    console.log(`   Generated chunked CSV: ${result.length} bytes total`);
    
    return result;
  }
  
  /**
   * Generate relationship CSV in chunks
   */
  static generateRelationshipCSVInChunks(relationships: GraphRelationship[], type: RelationshipType, chunkSize: number = 1000): string {
    if (relationships.length <= chunkSize) {
      return this.generateRelationshipCSV(relationships, type);
    }
    
    console.log(`📝 Generating CSV for ${relationships.length} ${type} relationships in chunks of ${chunkSize}`);
    
    const chunks: string[] = [];
    let header: string | null = null;
    
    for (let i = 0; i < relationships.length; i += chunkSize) {
      const chunk = relationships.slice(i, i + chunkSize);
      const csvChunk = this.generateRelationshipCSV(chunk, type);
      
      if (!csvChunk) continue;
      
      const lines = csvChunk.split('\n');
      
      if (header === null) {
        // First chunk - include header
        header = lines[0];
        chunks.push(csvChunk);
      } else {
        // Subsequent chunks - skip header
        const dataLines = lines.slice(1);
        if (dataLines.length > 0) {
          chunks.push(dataLines.join('\n'));
        }
      }
    }
    
    const result = chunks.join('\n');
    console.log(`   Generated chunked CSV: ${result.length} bytes total`);
    
    return result;
  }
}

/**
 * Utility functions for CSV operations
 */
export class CSVUtils {
  /**
   * Calculate optimal batch size based on estimated CSV size
   */
  static calculateOptimalBatchSize(nodes: GraphNode[], targetSizeBytes: number = 1024 * 1024): number {
    if (nodes.length === 0) return 100; // Default
    
    const estimatedSize = GitNexusCSVGenerator.estimateCSVSize(nodes);
    const avgNodeSize = estimatedSize / nodes.length;
    
    const optimalBatchSize = Math.floor(targetSizeBytes / avgNodeSize);
    
    // Clamp between reasonable bounds
    return Math.min(Math.max(optimalBatchSize, 10), 2000);
  }
  
  /**
   * Check if chunked processing is recommended
   */
  static shouldUseChunkedProcessing(itemCount: number, threshold: number = 1000): boolean {
    return itemCount > threshold;
  }
  
  /**
   * Get memory-safe chunk size based on available memory
   */
  static getMemorySafeChunkSize(itemCount: number): number {
    // Conservative chunk sizing for browser environments
    if (itemCount < 100) return itemCount;
    if (itemCount < 1000) return 500;
    if (itemCount < 5000) return 1000;
    return 1500; // Max chunk size for very large datasets
  }
}
