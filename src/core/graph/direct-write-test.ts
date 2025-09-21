/**
 * Quick test to verify direct-write implementation
 */

import { DirectWriteKnowledgeGraph } from './direct-write-knowledge-graph.ts';
import type { GraphNode } from './types.ts';

// Mock KuzuDB for testing
const mockKuzuGraph = {
  queryEngine: {
    executeQuery: async (query: string) => {
      console.log(`✅ Mock KuzuDB executed: ${query}`);
      return { rows: [], columns: [] };
    }
  },
  nodes: [],
  relationships: []
};

export async function testDirectWrite() {
  console.log('🧪 Testing Direct-Write Implementation...');
  
  const graph = new DirectWriteKnowledgeGraph(mockKuzuGraph as any, {
    enableDirectWrites: true,
    maxConcurrentWrites: 5,
    fallbackToBatching: true,
    retryAttempts: 2
  });

  // Test node with valid schema properties
  const testNode: GraphNode = {
    id: 'test-folder-1',
    label: 'Folder',
    properties: {
      name: 'test-folder',
      path: '/test/folder',
      fullPath: '/test/folder',
      depth: 2,
      // This should be filtered out (not in Folder schema)
      type: 'directory',
      invalidProperty: 'should-be-removed'
    }
  };

  console.log('📝 Adding test node...');
  graph.addNode(testNode);

  // Wait for async operations
  await new Promise(resolve => setTimeout(resolve, 100));
  
  console.log('🔄 Flushing pending operations...');
  await graph.flushPendingOperations();
  
  console.log('📊 Final stats:', graph.getStats());
  console.log('✅ Direct-write test completed!');
}

// Export for manual testing
if (typeof window !== 'undefined') {
  (window as any).testDirectWrite = testDirectWrite;
}
