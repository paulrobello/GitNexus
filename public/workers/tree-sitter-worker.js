/**
 * Tree-sitter Web Worker
 * Handles parallel parsing of source code files
 */

// Import tree-sitter and compiled queries using importScripts for classic workers
importScripts('/workers/tree-sitter.js');
importScripts('/workers/compiled-queries.js');

// Function to get queries for a specific language
function getQueriesForLanguage(language) {
  return queries[language] || null;
}

// Initialize tree-sitter
let parser = null;
let languageParsers = new Map();

// Initialize the worker
async function initializeWorker() {
  try {
    // Initialize tree-sitter (TreeSitter is available as a global from importScripts)
    await TreeSitter.init();
    parser = new TreeSitter();
    
    // Load language parsers
    const languageLoaders = {
      typescript: async () => {
        const language = await TreeSitter.Language.load('/wasm/typescript/tree-sitter-typescript.wasm');
        return language;
      },
      javascript: async () => {
        const language = await TreeSitter.Language.load('/wasm/javascript/tree-sitter-javascript.wasm');
        return language;
      },
      python: async () => {
        const language = await TreeSitter.Language.load('/wasm/python/tree-sitter-python.wasm');
        return language;
      }
    };

    for (const [lang, loader] of Object.entries(languageLoaders)) {
      try {
        const languageParser = await loader();
        languageParsers.set(lang, languageParser);
        console.log(`Worker: ${lang} parser loaded successfully`);
      } catch (error) {
        console.error(`Worker: Failed to load ${lang} parser:`, error);
      }
    }

    console.log('Worker: Tree-sitter worker initialized successfully');
    return true;
  } catch (error) {
    console.error('Worker: Failed to initialize tree-sitter worker:', error);
    return false;
  }
}

// Detect language from file path
function detectLanguage(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase();
  
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'py':
      return 'python';
    default:
      return 'javascript'; // Default fallback
  }
}

// Extract definitions from AST
function extractDefinitions(tree, filePath) {
  const definitions = [];
  const language = detectLanguage(filePath);
  
  // Get queries for the language
  const languageQueries = getQueriesForLanguage(language);
  if (!languageQueries) return definitions;

  // Execute queries to find definitions
  for (const [queryName, queryString] of Object.entries(languageQueries)) {
    try {
      const query = parser.getLanguage().query(queryString);
      const matches = query.matches(tree.rootNode);

      for (const match of matches) {
        const definition = processMatch(match, filePath, queryName);
        if (definition) {
          definitions.push(definition);
        }
      }
    } catch (error) {
      console.warn(`Worker: Error executing query ${queryName}:`, error);
    }
  }

  return definitions;
}

// Get queries for specific language - now uses imported compiled queries
// This ensures consistency with the main thread parsing logic

// Helper function to map query names to definition types (EXACTLY matches main thread)
function getDefinitionType(queryName) {
  switch (queryName) {
    case 'classes': 
    case 'exportClasses': return 'class';
    case 'methods': 
    case 'properties':
    case 'staticmethods':
    case 'classmethods': return 'method';
    case 'functions':
    case 'arrowFunctions':
    case 'reactComponents':
    case 'reactConstComponents':
    case 'defaultExportArrows':
    case 'variableAssignments':
    case 'objectMethods':
    case 'exportFunctions':
    case 'defaultExportFunctions':
    case 'functionExpressions': return 'function';
    case 'variables':
    case 'constDeclarations':
    case 'hookCalls':
    case 'hookDestructuring':
    case 'global_variables': return 'variable';
    case 'imports':
    case 'from_imports': return 'import';
    case 'exports':
    case 'defaultExports':
    case 'moduleExports': return 'function'; // Exports usually export functions
    case 'interfaces': return 'interface';
    case 'types': return 'type';
    case 'decorators': return 'decorator';
    case 'enums': return 'enum';
    default: return 'variable';
  }
}

// Process a query match into a definition
// EXACTLY matches main thread's extractDefinition logic
function processMatch(match, filePath, queryName) {
  try {
    const definitions = [];
    
    for (const capture of match.captures) {
      const node = capture.node;
      
      // Extract name using EXACT same logic as single-threaded
      let nameNode = node.childForFieldName('name');
      let name = nameNode ? nameNode.text : null;
      
      // Handle different naming patterns for different query types (EXACT match to single-threaded)
      if (!name) {
        // Try alternative naming strategies based on query type
        switch (queryName) {
          case 'variables':
          case 'constDeclarations':
          case 'global_variables':
            // For variable assignments, look for identifier in left side
            const leftChild = node.namedChildren.find(child => child.type === 'identifier');
            if (leftChild) name = leftChild.text;
            break;
            
          case 'hookCalls':
          case 'hookDestructuring':
            // For React hooks, try to get the variable name
            const hookVar = node.namedChildren.find(child => child.type === 'variable_declarator');
            if (hookVar) {
              const hookName = hookVar.childForFieldName('name');
              if (hookName) {
                // Handle array destructuring for useState pattern
                if (hookName.type === 'array_pattern') {
                  const elements = hookName.namedChildren.filter(child => child.type === 'identifier');
                  if (elements.length > 0) {
                    name = elements.map(el => el.text).join(', ');
                  }
                } else {
                  name = hookName.text;
                }
              }
            }
            break;
            
          case 'reactComponents':
          case 'reactConstComponents':
          case 'defaultExportArrows':
            // For React components, get the component name
            const componentVar = node.namedChildren.find(child => child.type === 'variable_declarator');
            if (componentVar) {
              const componentName = componentVar.childForFieldName('name');
              if (componentName) name = componentName.text;
            }
            break;
            
          case 'moduleExports':
            // For module.exports = something, get the property name
            const memberExpr = node.namedChildren.find(child => child.type === 'member_expression');
            if (memberExpr) {
              const property = memberExpr.childForFieldName('property');
              if (property) name = property.text;
            }
            break;
            
          case 'decorators':
            // For decorators, get the decorator name
            const decoratorChild = node.namedChildren.find(child => child.type === 'identifier');
            if (decoratorChild) name = decoratorChild.text;
            break;
            
          default:
            // Try to find any identifier child
            const identifierChild = node.namedChildren.find(child => child.type === 'identifier');
            if (identifierChild) name = identifierChild.text;
        }
      }
      
      // Skip anonymous definitions - they're usually from compiled/minified code (EXACT match to single-threaded)
      if (!name || name === 'anonymous' || name.trim().length === 0) {
        continue; // Skip this definition
      }
      
      // Skip very short names that are likely noise (but keep single-letter variables like 'i', 'x')
      if (name.length === 1 && queryName !== 'variables' && queryName !== 'constDeclarations') {
        continue;
      }
      
      // Skip common noise patterns
      const noisePatterns = ['_', '__', '___', 'temp', 'tmp'];
      if (noisePatterns.includes(name.toLowerCase())) {
        continue;
      }

      const definition = {
        name,
        type: getDefinitionType(queryName),
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      };
      
      // Extract additional metadata based on definition type (EXACT match to single-threaded)
      if (definition.type === 'function' || definition.type === 'method') {
        // Try to extract parameters
        const parametersNode = node.childForFieldName('parameters');
        if (parametersNode) {
          const params = [];
          for (const param of parametersNode.namedChildren) {
            if (param.type === 'identifier' || param.type === 'formal_parameter') {
              params.push(param.text);
            }
          }
          if (params.length > 0) {
            definition.parameters = params;
          }
        }
        
        // Mark React components
        if (queryName === 'reactComponents' || queryName === 'reactConstComponents') {
          definition.isAsync = false; // React components are not async by default
          definition.exportType = 'default'; // Most React components are default exports
        }
      }
      
      if (definition.type === 'class') {
        // Try to extract inheritance information
        const superclassNode = node.childForFieldName('superclass');
        if (superclassNode) {
          definition.extends = [superclassNode.text];
        }
      }
      
      // Handle variable types with additional context
      if (definition.type === 'variable') {
        if (queryName === 'hookCalls' || queryName === 'hookDestructuring') {
          definition.exportType = 'named'; // React hooks are typically named exports
          
          // Try to extract hook type from call expression
          const callExpr = node.descendantsOfType('call_expression')[0];
          if (callExpr) {
            const funcNode = callExpr.childForFieldName('function');
            if (funcNode && funcNode.type === 'identifier') {
              definition.returnType = funcNode.text; // Store hook function name
            }
          }
        }
      }
      
      definitions.push(definition);
    }
    
    // Return the first definition (main thread processes one capture at a time)
    return definitions.length > 0 ? definitions[0] : null;
  } catch (error) {
    console.warn('Worker: Error processing match:', error);
    return null;
  }
}

// Parse a single file
async function parseFile(filePath, content) {
  try {
    const language = detectLanguage(filePath);
    const languageParser = languageParsers.get(language);
    
    if (!languageParser) {
      throw new Error(`No parser available for language: ${language}`);
    }

    // Set the language
    parser.setLanguage(languageParser);
    
    // Parse the content
    const tree = parser.parse(content);
    
    // Extract definitions
    const definitions = extractDefinitions(tree, filePath);
    
    return {
      filePath,
      definitions,
      ast: {
        tree: {
          rootNode: {
            startPosition: tree.rootNode.startPosition,
            endPosition: tree.rootNode.endPosition,
            type: tree.rootNode.type,
            text: tree.rootNode.text
          }
        }
      }
    };
  } catch (error) {
    console.error(`Worker: Error parsing file ${filePath}:`, error);
    
    // Return a result with error information instead of throwing
    return {
      filePath,
      definitions: [],
      error: error.message || 'Unknown parsing error',
      ast: null
    };
  }
}

// Handle messages from main thread
self.onmessage = async function(event) {
  const { taskId, input } = event.data;
  
  try {
    // Initialize worker if not already done
    if (!parser) {
      const initialized = await initializeWorker();
      if (!initialized) {
        throw new Error('Failed to initialize tree-sitter worker');
      }
    }

    const { filePath, content } = input;
    
    // Parse the file
    const result = await parseFile(filePath, content);
    
    // Send result back to main thread
    self.postMessage({
      taskId,
      result
    });
    
  } catch (error) {
    // Send error back to main thread
    self.postMessage({
      taskId,
      error: error.message || 'Unknown error in tree-sitter worker'
    });
  }
};

// Handle worker errors
self.onerror = function(error) {
  console.error('Worker: Unhandled error:', error);
  self.postMessage({
    taskId: 'error',
    error: error.message || 'Unhandled worker error'
  });
};

console.log('Worker: Tree-sitter worker script loaded');
