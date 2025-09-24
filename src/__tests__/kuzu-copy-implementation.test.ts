/**
 * KuzuDB COPY Implementation Tests
 * 
 * Tests for the new COPY-based bulk loading functionality
 */

import { GitNexusCSVGenerator, CSVUtils } from '../core/kuzu/csv-generator';
import type { GraphNode, GraphRelationship, NodeLabel, RelationshipType } from '../core/graph/types';

describe('GitNexusCSVGenerator', () => {
  describe('generateNodeCSV', () => {
    it('should generate valid CSV for Function nodes', () => {
      const nodes: GraphNode[] = [
        {
          id: 'func_1',
          label: 'Function',
          properties: {
            name: 'testFunction',
            filePath: '/src/test.ts',
            startLine: 10,
            endLine: 20,
            parameters: ['param1', 'param2'],
            returnType: 'string',
            isAsync: true,
            isStatic: false
          }
        },
        {
          id: 'func_2',
          label: 'Function',
          properties: {
            name: 'anotherFunction',
            filePath: '/src/another.ts',
            startLine: 30,
            endLine: 40,
            parameters: [],
            returnType: 'void'
          }
        }
      ];
      
      const csv = GitNexusCSVGenerator.generateNodeCSV(nodes, 'Function');
      
      // Check header
      expect(csv).toContain('id,');
      expect(csv).toContain('name,');
      expect(csv).toContain('filePath,');
      
      // Check data rows
      expect(csv).toContain('func_1,testFunction');
      expect(csv).toContain('func_2,anotherFunction');
      
      // Check array handling
      expect(csv).toContain('"[""param1"",""param2""]"'); // Escaped JSON array
      
      // Check boolean handling
      expect(csv).toContain('true');
      expect(csv).toContain('false');
    });
    
    it('should handle special characters in CSV', () => {
      const nodes: GraphNode[] = [
        {
          id: 'test_1',
          label: 'Function',
          properties: {
            name: 'function,with"quotes',
            docstring: 'Multi\nline\ndocstring',
            filePath: '/src/test.ts'
          }
        }
      ];
      
      const csv = GitNexusCSVGenerator.generateNodeCSV(nodes, 'Function');
      
      // Check proper CSV escaping
      expect(csv).toContain('"function,with""quotes"');
      expect(csv).toContain('"Multi\nline\ndocstring"');
    });
    
    it('should handle empty node list', () => {
      const csv = GitNexusCSVGenerator.generateNodeCSV([], 'Function');
      expect(csv).toBe('');
    });
    
    it('should filter nodes by label', () => {
      const nodes: GraphNode[] = [
        {
          id: 'func_1',
          label: 'Function',
          properties: { name: 'testFunction' }
        },
        {
          id: 'class_1',
          label: 'Class',
          properties: { name: 'TestClass' }
        }
      ];
      
      const csv = GitNexusCSVGenerator.generateNodeCSV(nodes, 'Function');
      
      expect(csv).toContain('func_1');
      expect(csv).not.toContain('class_1');
    });
  });
  
  describe('generateRelationshipCSV', () => {
    it('should generate valid CSV for CALLS relationships', () => {
      const relationships: GraphRelationship[] = [
        {
          id: 'call_1',
          type: 'CALLS',
          source: 'func_1',
          target: 'func_2',
          properties: {
            callType: 'direct',
            startLine: 15,
            functionName: 'testFunction'
          }
        },
        {
          id: 'call_2',
          type: 'CALLS',
          source: 'func_2',
          target: 'func_3',
          properties: {
            callType: 'indirect',
            startLine: 25
          }
        }
      ];
      
      const csv = GitNexusCSVGenerator.generateRelationshipCSV(relationships, 'CALLS');
      
      // Check header
      expect(csv).toContain('source,target');
      expect(csv).toContain('callType');
      expect(csv).toContain('startLine');
      
      // Check data
      expect(csv).toContain('func_1,func_2');
      expect(csv).toContain('func_2,func_3');
      expect(csv).toContain('direct');
      expect(csv).toContain('indirect');
    });
    
    it('should handle empty relationship list', () => {
      const csv = GitNexusCSVGenerator.generateRelationshipCSV([], 'CALLS');
      expect(csv).toBe('');
    });
    
    it('should filter relationships by type', () => {
      const relationships: GraphRelationship[] = [
        {
          id: 'call_1',
          type: 'CALLS',
          source: 'func_1',
          target: 'func_2',
          properties: {}
        },
        {
          id: 'import_1',
          type: 'IMPORTS',
          source: 'file_1',
          target: 'file_2',
          properties: {}
        }
      ];
      
      const csv = GitNexusCSVGenerator.generateRelationshipCSV(relationships, 'CALLS');
      
      expect(csv).toContain('call_1');
      expect(csv).not.toContain('import_1');
    });
  });
  
  describe('CSV validation', () => {
    it('should validate correct CSV format', () => {
      const validCSV = `name,age,city
"John Doe",30,New York
"Jane Smith",25,Boston`;
      
      const result = GitNexusCSVGenerator.validateCSVFormat(validCSV);
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
    
    it('should detect invalid CSV format', () => {
      const invalidCSV = `name,age,city
"John Doe",30,New York,Extra
"Jane Smith",25`;
      
      const result = GitNexusCSVGenerator.validateCSVFormat(invalidCSV);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
    
    it('should handle empty CSV', () => {
      const result = GitNexusCSVGenerator.validateCSVFormat('');
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('CSV data is empty');
    });
  });
  
  describe('CSVUtils', () => {
    it('should calculate optimal batch size', () => {
      const nodes: GraphNode[] = Array.from({ length: 100 }, (_, i) => ({
        id: `node_${i}`,
        label: 'Function',
        properties: {
          name: `function_${i}`,
          filePath: `/src/file_${i}.ts`,
          startLine: i * 10,
          endLine: i * 10 + 5
        }
      }));
      
      const batchSize = CSVUtils.calculateOptimalBatchSize(nodes);
      
      expect(batchSize).toBeGreaterThan(0);
      expect(batchSize).toBeLessThanOrEqual(2000);
    });
    
    it('should recommend chunked processing for large datasets', () => {
      expect(CSVUtils.shouldUseChunkedProcessing(500)).toBe(false);
      expect(CSVUtils.shouldUseChunkedProcessing(1500)).toBe(true);
    });
    
    it('should provide memory-safe chunk sizes', () => {
      expect(CSVUtils.getMemorySafeChunkSize(50)).toBe(50);
      expect(CSVUtils.getMemorySafeChunkSize(500)).toBe(500);
      expect(CSVUtils.getMemorySafeChunkSize(2000)).toBe(1000);
      expect(CSVUtils.getMemorySafeChunkSize(10000)).toBe(1500);
    });
  });
  
  describe('Chunked CSV generation', () => {
    it('should generate CSV in chunks for large datasets', () => {
      const nodes: GraphNode[] = Array.from({ length: 2500 }, (_, i) => ({
        id: `node_${i}`,
        label: 'Function',
        properties: {
          name: `function_${i}`,
          filePath: `/src/file_${i}.ts`
        }
      }));
      
      const csv = GitNexusCSVGenerator.generateNodeCSVInChunks(nodes, 'Function', 1000);
      
      // Should contain all nodes
      expect(csv.split('\n').length).toBeGreaterThan(2500); // +1 for header
      expect(csv).toContain('node_0');
      expect(csv).toContain('node_2499');
      
      // Should have only one header
      const headerCount = (csv.match(/^id,/gm) || []).length;
      expect(headerCount).toBe(1);
    });
  });
});

// Mock data generators for testing
function generateTestNodes(count: number, label: NodeLabel): GraphNode[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${label.toLowerCase()}_${i}`,
    label,
    properties: {
      name: `test${label}${i}`,
      filePath: `/src/test${i}.ts`,
      startLine: i * 10,
      endLine: i * 10 + 5
    }
  }));
}

function generateTestRelationships(count: number, type: RelationshipType): GraphRelationship[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${type.toLowerCase()}_${i}`,
    type,
    source: `source_${i}`,
    target: `target_${i}`,
    properties: {
      line: i * 5
    }
  }));
}

export { generateTestNodes, generateTestRelationships };
