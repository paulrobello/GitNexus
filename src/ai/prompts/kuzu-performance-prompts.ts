/**
 * KuzuDB Performance-Optimized Prompts
 * Specialized prompts for leveraging KuzuDB's strengths
 */

export const KUZU_PERFORMANCE_PROMPTS = {
  /**
   * System prompt for performance-focused queries
   */
  PERFORMANCE_SYSTEM: `You are a Cypher query expert specializing in high-performance graph database queries using KuzuDB with a POLYMORPHIC SCHEMA. Your goal is to generate optimized queries that leverage KuzuDB's strengths.

CRITICAL: This database uses a polymorphic schema:
- All nodes: CodeElement with elementType discriminator
- All relationships: CodeRelationship with relationshipType discriminator

KUZUDB OPTIMIZATION PRINCIPLES:
1. POLYMORPHIC QUERIES: Always use elementType and relationshipType filters
2. COMPLEX TRAVERSALS: KuzuDB excels at variable-length path queries
3. PATTERN MATCHING: Use sophisticated WHERE clauses for filtering
4. AGGREGATION: Leverage COUNT, COLLECT, and other aggregation functions
5. INDEXING: Prefer queries that can use elementType indexes
6. BATCHING: Structure queries to minimize round trips

POLYMORPHIC PERFORMANCE PATTERNS:
- Use (start:CodeElement {elementType: 'Function'})-[r:CodeRelationship {relationshipType: 'CALLS'}*1..5]->(end:CodeElement {elementType: 'Function'}) for dependency chains
- Leverage WHERE clauses with CONTAINS for text search on CodeElement properties
- Use aggregation for statistics: COUNT, COLLECT, AVG on CodeElement nodes
- Always specify elementType for better index utilization
- Use LIMIT clauses to control result size

OPTIMIZED QUERY TYPES:
1. Dependency Analysis: MATCH (target:CodeElement {elementType: 'Function'})<-[r:CodeRelationship {relationshipType: 'CALLS'}*1..5]-(caller:CodeElement)
2. Call Chain Traversal: MATCH (start:CodeElement {elementType: 'Function'})-[r:CodeRelationship {relationshipType: 'CALLS'}*]->(end:CodeElement {elementType: 'Function'})
3. Pattern Matching: MATCH (n:CodeElement) WHERE n.elementType IN ['Function', 'Method'] AND n.name CONTAINS 'pattern'
4. Statistical Analysis: MATCH (f:CodeElement {elementType: 'File'})-[r:CodeRelationship {relationshipType: 'CONTAINS'}]->(func:CodeElement {elementType: 'Function'}) RETURN f.name, COUNT(func)
5. Relationship Exploration: MATCH (a:CodeElement)-[r:CodeRelationship]->(b:CodeElement) WHERE r.relationshipType IN ['CALLS', 'IMPORTS']

Always use polymorphic patterns and consider execution time and result relevance when generating queries.`,

  /**
   * Prompt for complex dependency analysis
   */
  DEPENDENCY_ANALYSIS: `Generate a Cypher query for dependency analysis that leverages KuzuDB's strength in variable-length path traversal.

Focus on:
- Finding all dependencies of a specific function/class
- Identifying call chains and dependency trees
- Discovering indirect dependencies (2+ hops away)
- Analyzing dependency depth and complexity

Use patterns like:
- (start)-[:CALLS*1..5]->(end) for call chains
- (start)-[:IMPORTS*1..3]->(end) for import dependencies
- WHERE clauses to filter by specific criteria
- Aggregation to summarize dependency statistics`,

  /**
   * Prompt for performance monitoring queries
   */
  PERFORMANCE_MONITORING: `Generate Cypher queries for monitoring and analyzing codebase performance metrics.

Focus on:
- Counting entities by type (functions, classes, methods)
- Analyzing code complexity through relationship density
- Identifying performance bottlenecks in call chains
- Measuring code coupling and cohesion

Use aggregation functions:
- COUNT() for entity counting
- COLLECT() for gathering lists
- AVG() for average metrics
- MAX()/MIN() for range analysis

Structure queries to provide actionable performance insights.`,

  /**
   * Prompt for code pattern discovery
   */
  PATTERN_DISCOVERY: `Generate Cypher queries for discovering code patterns and architectural insights.

Focus on:
- Finding similar code structures
- Identifying design patterns
- Discovering architectural relationships
- Analyzing code organization

Use patterns like:
- Pattern matching with WHERE clauses
- Relationship traversal for structural analysis
- Aggregation for pattern frequency
- Variable-length paths for complex relationships

Aim to reveal hidden patterns and architectural insights.`
};

/**
 * Performance-focused query examples
 */
export const PERFORMANCE_QUERY_EXAMPLES = [
  {
    question: "Find all functions that are called through a chain of 3-5 function calls from the main function",
    cypher: "MATCH (main:Function {name: 'main'})-[:CALLS*3..5]->(target:Function) RETURN main.name, target.name, target.filePath",
    explanation: "Uses variable-length path to find functions 3-5 calls away from main"
  },
  {
    question: "Count how many functions each class contains and show the most complex classes",
    cypher: "MATCH (c:Class)-[:CONTAINS]->(f:Function) RETURN c.name, COUNT(f) as functionCount ORDER BY functionCount DESC LIMIT 10",
    explanation: "Uses aggregation to count functions per class and orders by complexity"
  },
  {
    question: "Find all functions that are called by more than 5 other functions",
    cypher: "MATCH (caller:Function)-[:CALLS]->(target:Function) WITH target, COUNT(caller) as callCount WHERE callCount > 5 RETURN target.name, callCount ORDER BY callCount DESC",
    explanation: "Uses aggregation to find frequently called functions"
  },
  {
    question: "Show the dependency chain from authentication functions to database functions",
    cypher: "MATCH (auth:Function)-[:CALLS*1..5]->(db:Function) WHERE auth.name CONTAINS 'auth' AND db.name CONTAINS 'db' RETURN auth.name, db.name",
    explanation: "Uses variable-length path to trace authentication to database calls"
  },
  {
    question: "Find all classes that implement more than 2 interfaces",
    cypher: "MATCH (c:Class)-[:IMPLEMENTS]->(i:Interface) WITH c, COUNT(i) as interfaceCount WHERE interfaceCount > 2 RETURN c.name, interfaceCount",
    explanation: "Uses aggregation to find classes with multiple interface implementations"
  }
];

/**
 * Performance monitoring query templates
 */
export const PERFORMANCE_TEMPLATES = {
  // Code complexity analysis
  COMPLEXITY_ANALYSIS: `
    MATCH (f:Function)
    OPTIONAL MATCH (f)-[:CALLS]->(called:Function)
    WITH f, COUNT(called) as outgoingCalls
    OPTIONAL MATCH (caller:Function)-[:CALLS]->(f)
    WITH f, outgoingCalls, COUNT(caller) as incomingCalls
    RETURN f.name, f.filePath, outgoingCalls, incomingCalls, (outgoingCalls + incomingCalls) as totalComplexity
    ORDER BY totalComplexity DESC
    LIMIT 20
  `,

  // Dependency depth analysis
  DEPENDENCY_DEPTH: `
    MATCH (start:Function {name: $functionName})-[:CALLS*1..10]->(target:Function)
    WITH target, LENGTH(shortestPath((start)-[:CALLS*]->(target))) as depth
    RETURN target.name, target.filePath, depth
    ORDER BY depth
  `,

  // Code coupling analysis
  COUPLING_ANALYSIS: `
    MATCH (f1:Function)-[:CALLS]->(f2:Function)
    WHERE f1.filePath <> f2.filePath
    WITH f1.filePath as file1, f2.filePath as file2, COUNT(*) as coupling
    WHERE coupling > 5
    RETURN file1, file2, coupling
    ORDER BY coupling DESC
  `,

  // Architecture pattern detection
  PATTERN_DETECTION: `
    MATCH (c:Class)-[:CONTAINS]->(m:Method)
    WHERE m.name CONTAINS 'get' OR m.name CONTAINS 'set'
    WITH c, COUNT(m) as accessorCount
    WHERE accessorCount > 3
    RETURN c.name, c.filePath, accessorCount
    ORDER BY accessorCount DESC
  `
};
