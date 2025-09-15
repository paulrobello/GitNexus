/**
 * Parallel Processing Integration Test
 * Tests the new parallel processing implementation
 */

import { GraphPipeline } from '../core/ingestion/pipeline';
import type { PipelineInput } from '../core/ingestion/pipeline';

describe('Parallel Processing Integration', () => {
  let pipeline: GraphPipeline;

  beforeEach(() => {
    pipeline = new GraphPipeline();
  });

  it('should process files using parallel processing', async () => {
    // Mock file data with TypeScript and JavaScript files
    const mockFileContents = new Map<string, string>([
      ['src/test.ts', `
        function testFunction(param: string): string { 
          return "test: " + param; 
        }
        
        export class TestClass {
          private value: number = 42;
          
          public getValue(): number {
            return this.value;
          }
        }
      `],
      ['src/helper.js', `
        function helperFunction() { 
          return "help"; 
        }
        
        const constantValue = 100;
        
        module.exports = { helperFunction, constantValue };
      `],
      ['src/utils.ts', `
        export interface Config {
          name: string;
          version: number;
        }
        
        export function processConfig(config: Config): boolean {
          return config.name.length > 0 && config.version > 0;
        }
      `]
    ]);
    
    const mockFilePaths = Array.from(mockFileContents.keys());
    
    const input: PipelineInput = {
      projectRoot: '/test-project',
      projectName: 'parallel-test',
      filePaths: mockFilePaths,
      fileContents: mockFileContents,
      options: {
        directoryFilter: 'src',
        fileExtensions: '.ts,.js'
      }
    };

    // Process with parallel pipeline
    console.log('🧪 Testing parallel processing pipeline...');
    const startTime = Date.now();
    
    const graph = await pipeline.run(input);
    
    const endTime = Date.now();
    const processingTime = endTime - startTime;
    
    console.log(`⏱️ Parallel processing completed in ${processingTime}ms`);

    // Validate results
    expect(graph).toBeDefined();
    expect(graph.nodes).toBeDefined();
    expect(graph.relationships).toBeDefined();
    
    // Should have nodes for files
    const fileNodes = graph.nodes.filter(node => node.label === 'File');
    expect(fileNodes.length).toBe(3); // 3 files
    
    // Should have nodes for functions
    const functionNodes = graph.nodes.filter(node => node.label === 'Function');
    expect(functionNodes.length).toBeGreaterThan(0);
    
    // Should have nodes for classes  
    const classNodes = graph.nodes.filter(node => node.label === 'Class');
    expect(classNodes.length).toBeGreaterThan(0);
    
    // Should have relationships
    expect(graph.relationships.length).toBeGreaterThan(0);
    
    // Log statistics
    const nodeStats = graph.nodes.reduce((acc, node) => {
      acc[node.label] = (acc[node.label] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const relationshipStats = graph.relationships.reduce((acc, rel) => {
      acc[rel.type] = (acc[rel.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    console.log('📊 Parallel Processing Test Results:');
    console.log('Node types:', nodeStats);
    console.log('Relationship types:', relationshipStats);
    console.log(`Total nodes: ${graph.nodes.length}`);
    console.log(`Total relationships: ${graph.relationships.length}`);
    
    // Basic validation that we got meaningful results
    expect(graph.nodes.length).toBeGreaterThan(5); // Should have files + definitions
    expect(Object.keys(nodeStats)).toContain('File');
    expect(Object.keys(nodeStats)).toContain('Function');
  }, 30000); // 30 second timeout for worker initialization

  it('should handle worker pool initialization', async () => {
    const mockFileContents = new Map<string, string>([
      ['simple.ts', 'const value = 42;']
    ]);
    
    const input: PipelineInput = {
      projectRoot: '/simple-test',
      projectName: 'worker-test',
      filePaths: ['simple.ts'],
      fileContents: mockFileContents
    };

    // This should initialize the worker pool without errors
    const graph = await pipeline.run(input);
    
    expect(graph).toBeDefined();
    expect(graph.nodes.length).toBeGreaterThan(0);
  }, 30000);

  it('should provide diagnostic information', () => {
    const diagnostics = pipeline.getParsingDiagnostics();
    
    expect(diagnostics).toBeDefined();
    expect(typeof diagnostics.processedFiles).toBe('number');
    expect(typeof diagnostics.skippedFiles).toBe('number');
    expect(typeof diagnostics.totalDefinitions).toBe('number');
  });
});
