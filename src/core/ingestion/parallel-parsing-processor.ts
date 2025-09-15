import { GraphNode, GraphRelationship, NodeLabel, RelationshipType } from '../graph/types.js';
import { MemoryManager } from '../../services/memory-manager.js';
import { KnowledgeGraph, GraphProcessor } from '../graph/graph.js';
import {
  OptimizedSet,
  DuplicateDetector,
  pathUtils
} from '../../lib/shared-utils.js';
import { IGNORE_PATTERNS } from '../../config/language-config.js';
import { WebWorkerPool, WebWorkerPoolUtils } from '../../lib/web-worker-pool.js';
import { FunctionRegistryTrie, FunctionDefinition } from '../graph/trie.js';
import { generateId } from '../../lib/utils.ts';
import Parser from 'web-tree-sitter';
import { initTreeSitter, loadTypeScriptParser, loadPythonParser, loadJavaScriptParser } from '../tree-sitter/parser-loader.js';

export interface ParsingInput {
	filePaths: string[];
	fileContents: Map<string, string>;
	options?: { directoryFilter?: string; fileExtensions?: string };
}

export interface ParsedDefinition {
	name: string;
	type: 'function' | 'class' | 'method' | 'variable' | 'import' | 'interface' | 'type' | 'decorator';
	startLine: number;
	endLine?: number;
	parameters?: string[] | undefined;
	returnType?: string | undefined;
	accessibility?: 'public' | 'private' | 'protected';
	isStatic?: boolean | undefined;
	isAsync?: boolean | undefined;
	parentClass?: string | undefined;
	decorators?: string[] | undefined;
	extends?: string[] | undefined;
	implements?: string[] | undefined;
	importPath?: string | undefined;
	exportType?: 'named' | 'default' | 'namespace';
	docstring?: string | undefined;
}

export interface ParsedAST {
  tree: any;
}

export interface ParallelParsingResult {
  filePath: string;
  definitions: ParsedDefinition[];
  ast: ParsedAST;
  success: boolean;
  error?: string;
}



export class ParallelParsingProcessor implements GraphProcessor<ParsingInput> {
	private memoryManager: MemoryManager;
	private duplicateDetector = new DuplicateDetector<string>((item: string) => item);
	private processedFiles = new OptimizedSet<string>();
  private astMap: Map<string, ParsedAST> = new Map();
  private functionTrie: FunctionRegistryTrie = new FunctionRegistryTrie();
  private workerPool: WebWorkerPool;
  private isInitialized: boolean = false;
  private parser: Parser | null = null;
  private languageParsers: Map<string, Parser.Language> = new Map();

	constructor() {
		this.memoryManager = MemoryManager.getInstance();
		this.workerPool = WebWorkerPoolUtils.createCPUPool({
			workerScript: '/workers/tree-sitter-worker.js',
			name: 'ParallelParsingPool',
			timeout: 60000 // 60 seconds for parsing
		});
	}

  public getASTMap(): Map<string, ParsedAST> {
    return this.astMap;
  }

  public getFunctionRegistry(): FunctionRegistryTrie {
    return this.functionTrie;
  }

	/**
	 * Initialize the worker pool
	 */
	private async initializeWorkerPool(): Promise<void> {
		if (this.isInitialized) return;

		try {
			console.log('ParallelParsingProcessor: Initializing worker pool...');
			
			// Check if Web Workers are supported
			if (!WebWorkerPoolUtils.isSupported()) {
				throw new Error('Web Workers are not supported in this environment');
			}

			// Set up worker pool event listeners
			this.workerPool.on('workerCreated', (data: unknown) => {
				const { workerId, totalWorkers } = data as { workerId: number, totalWorkers: number };
				console.log(`ParallelParsingProcessor: Worker ${workerId} created (${totalWorkers} total)`);
			});

			this.workerPool.on('workerError', (data: unknown) => {
				const { workerId, error } = data as { workerId: number, error: string };
				console.warn(`ParallelParsingProcessor: Worker ${workerId} error:`, error);
			});

			this.workerPool.on('shutdown', () => {
				console.log('ParallelParsingProcessor: Worker pool shutdown');
			});

			this.isInitialized = true;
			console.log('ParallelParsingProcessor: Worker pool initialized successfully');
		} catch (error) {
			console.error('ParallelParsingProcessor: Failed to initialize worker pool:', error);
			throw error;
		}
	}

	public async process(graph: KnowledgeGraph, input: ParsingInput): Promise<void> {
		const { filePaths, fileContents, options } = input;

		console.log(`ParallelParsingProcessor: Processing ${filePaths.length} total paths with worker pool`);

		const memoryStats = this.memoryManager.getStats();
		console.log(`Memory status: ${memoryStats.usedMemoryMB}MB used, ${memoryStats.fileCount} files cached`);

		// Initialize worker pool
		await this.initializeWorkerPool();

		const filteredFiles = this.applyFiltering(filePaths, fileContents, options);
		
		console.log(`ParallelParsingProcessor: After filtering: ${filteredFiles.length} files to parse`);

		const sourceFiles = filteredFiles.filter((path: string) => this.isSourceFile(path));
		const configFiles = filteredFiles.filter((path: string) => this.isConfigFile(path));
		const allProcessableFiles = [...sourceFiles, ...configFiles];
		
		console.log(`ParallelParsingProcessor: Found ${sourceFiles.length} source files and ${configFiles.length} config files`);

		try {
			// Process files in parallel using worker pool
			const results = await this.processFilesInParallel(allProcessableFiles, fileContents);
			
			// Process results and build graph
			await this.processResults(results, graph, fileContents);
			
			console.log(`ParallelParsingProcessor: Successfully processed ${this.processedFiles.size} files`);
		} catch (error) {
			console.error('ParallelParsingProcessor: Error during parallel processing:', error);
			throw error;
		}
	}

	/**
	 * Process files in parallel using worker pool
	 */
	private async processFilesInParallel(
		filePaths: string[], 
		fileContents: Map<string, string>
	): Promise<ParallelParsingResult[]> {
		const startTime = performance.now();
		
		// Prepare tasks for worker pool
		const tasks = filePaths.map(filePath => ({
			filePath,
			content: fileContents.get(filePath) || ''
		}));

		console.log(`ParallelParsingProcessor: Starting parallel processing of ${tasks.length} files`);

		try {
			// Process with progress tracking
			const results = await this.workerPool.executeWithProgress<any, ParallelParsingResult>(
				tasks,
				(completed, total) => {
					const progress = ((completed / total) * 100).toFixed(1);
					console.log(`ParallelParsingProcessor: Progress: ${progress}% (${completed}/${total})`);
				}
			);

			const endTime = performance.now();
			const duration = endTime - startTime;
			
			console.log(`ParallelParsingProcessor: Parallel processing completed in ${duration.toFixed(2)}ms`);
			console.log(`ParallelParsingProcessor: Average time per file: ${(duration / tasks.length).toFixed(2)}ms`);

			// Log worker pool statistics
			const stats = this.workerPool.getStats();
			console.log('ParallelParsingProcessor: Worker pool stats:', stats);

			// Transform worker results to match expected format
			const transformedResults: ParallelParsingResult[] = results.map((result: any, index: number) => {
				if (result && result.filePath) {
					return {
						filePath: result.filePath,
						definitions: result.definitions || [],
						ast: result.ast || null,
						success: !result.error,
						error: result.error
					};
				} else {
					// Handle undefined/null results
					return {
						filePath: tasks[index]?.filePath || 'unknown',
						definitions: [],
						ast: null,
						success: false,
						error: 'Worker returned undefined result'
					};
				}
			});

			return transformedResults;
		} catch (error) {
			console.error('ParallelParsingProcessor: Error in parallel processing:', error);
			throw error;
		}
	}

	/**
	 * Process parsing results and build graph
	 */
	private async processResults(results: ParallelParsingResult[], graph: KnowledgeGraph, fileContents: Map<string, string>): Promise<void> {
		console.log(`ParallelParsingProcessor: Processing ${results.length} parsing results`);

		let successfulFiles = 0;
		let failedFiles = 0;
		let totalDefinitions = 0;

		// Initialize main thread parser for AST recreation (needed for import/call processors)
		await this.initializeMainThreadParser();

		for (const result of results) {
			if (result.success) {
				successfulFiles++;
				
				// Recreate full AST in main thread (workers can't serialize Tree-sitter objects)
				await this.recreateAST(result.filePath, fileContents);

				// Process definitions
				if (result.definitions && result.definitions.length > 0) {
					await this.processDefinitions(result.filePath, result.definitions, graph);
					totalDefinitions += result.definitions.length;
				}

				this.processedFiles.add(result.filePath);
			} else {
				failedFiles++;
				console.warn(`ParallelParsingProcessor: Failed to parse ${result.filePath}: ${result.error}`);
			}
		}

		console.log(`ParallelParsingProcessor: Processing complete - ${successfulFiles} successful, ${failedFiles} failed`);
		console.log(`ParallelParsingProcessor: Total definitions extracted: ${totalDefinitions}`);
	}

	/**
	 * Process definitions and add to graph
	 */
	private async processDefinitions(
		filePath: string, 
		definitions: ParsedDefinition[], 
		graph: KnowledgeGraph
	): Promise<void> {
		for (const definition of definitions) {
			try {
				await this.addDefinitionToGraph(filePath, definition, graph);
			} catch (error) {
				console.warn(`ParallelParsingProcessor: Error processing definition ${definition.name}:`, error);
			}
		}
	}

	/**
	 * Add a definition to the graph
	 */
	private async addDefinitionToGraph(
		filePath: string, 
		definition: ParsedDefinition, 
		graph: KnowledgeGraph
	): Promise<void> {
		// Generate unique ID based on file path and definition name (same as single-threaded)
		const nodeId = generateId(`${definition.type}_${filePath}_${definition.name}_${definition.startLine}`);
		
		if (this.duplicateDetector.isDuplicate(nodeId)) {
			return;
		}

		// Create graph node
		const node: GraphNode = {
			id: nodeId,
			label: this.mapDefinitionTypeToNodeLabel(definition.type),
			properties: {
				name: definition.name,
				filePath,
				startLine: definition.startLine,
				endLine: definition.endLine,
				type: definition.type,
				parameters: definition.parameters,
				returnType: definition.returnType,
				accessibility: definition.accessibility,
				isStatic: definition.isStatic,
				isAsync: definition.isAsync,
				parentClass: definition.parentClass,
				decorators: definition.decorators?.join(', '),
				extends: definition.extends?.join(', '),
				implements: definition.implements?.join(', '),
				importPath: definition.importPath,
				exportType: definition.exportType,
				docstring: definition.docstring
			}
		};

		graph.addNode(node);

		// Add to function registry if applicable
		if (['function', 'method', 'class', 'interface', 'enum'].includes(definition.type)) {
			const functionDef: FunctionDefinition = {
				nodeId: nodeId,
        qualifiedName: `${filePath}:${definition.name}`,
        filePath,
        functionName: definition.name,
        type: definition.type as 'function' | 'method' | 'class' | 'interface' | 'enum',
			};
			this.functionTrie.addDefinition(functionDef);
		}

		// Find existing file node created by StructureProcessor (same as single-threaded)
		let fileNode = graph.nodes.find(node => 
			node.label === 'File' && 
			(node.properties.filePath === filePath || node.properties.path === filePath)
		);

		// If no existing file node found, create one (fallback)
		if (!fileNode) {
			fileNode = { 
				id: generateId(`file_${filePath}`),
				label: 'File' as NodeLabel,
				properties: {
					name: pathUtils.getFileName(filePath),
					path: filePath,
					filePath: filePath,
					language: this.detectLanguage(filePath)
				}
			};
			graph.addNode(fileNode);
		}

		// Add DEFINES relationship from file to definition (same as single-threaded)
		const definesRelationship: GraphRelationship = {
			id: generateId('defines'),
			type: 'DEFINES' as RelationshipType,
			source: fileNode.id,
			target: nodeId,
			properties: { 
				filePath: filePath, 
				line_number: definition.startLine 
			}
		};

		graph.addRelationship(definesRelationship);

		// Add additional relationships like single-threaded version
		if (definition.extends && definition.extends.length > 0) {
			definition.extends.forEach(() => {
				const extendsRelationship: GraphRelationship = { 
					id: generateId('extends'),
					type: 'EXTENDS' as RelationshipType,
					source: nodeId,
					target: generateId('class'),
					properties: {}
				};

				graph.addRelationship(extendsRelationship);
			});
		}

		if (definition.implements && definition.implements.length > 0) {
			definition.implements.forEach(() => {
				const implementsRelationship: GraphRelationship = {
					id: generateId('implements'),
					type: 'IMPLEMENTS' as RelationshipType,
					source: nodeId,
					target: generateId('interface'),
					properties: {}
				};

				graph.addRelationship(implementsRelationship);
			});
		}

		if (definition.importPath) {
			const importRelationship: GraphRelationship = { 
				id: generateId('imports'),
				type: 'IMPORTS' as RelationshipType,
				source: nodeId, 
				target: generateId('file'),
				properties: { 
					importPath: definition.importPath 
				}
			};
			graph.addRelationship(importRelationship);
		}

		if (definition.parentClass) {			  
			const parentRelationship: GraphRelationship = {
				id: generateId('belongs_to'),
				type: 'BELONGS_TO' as RelationshipType,
				source: nodeId,
				target: generateId('class'),
				properties: { parentClass: definition.parentClass }
			};
			graph.addRelationship(parentRelationship);
		}
	}

	/**
	 * Map definition type to node label
	 */
	private mapDefinitionTypeToNodeLabel(type: string): NodeLabel {
		switch (type) {
			case 'function':
				return 'Function';
			case 'class':
				return 'Class';
			case 'method':
				return 'Method';
			case 'variable':
				return 'Variable';
			case 'import':
				return 'Import';
			case 'interface':
				return 'Interface';
			case 'type':
				return 'Type';
			case 'decorator':
				return 'Decorator';
			default:
				return 'CodeElement';
		}
	}


	private applyFiltering(
		filePaths: string[], 
		fileContents: Map<string, string>, 
		options?: { directoryFilter?: string; fileExtensions?: string }): string[] {

		let filtered = filePaths;

		// Apply directory filter if specified
		if (options?.directoryFilter) {
			filtered = filtered.filter(path => path.includes(options.directoryFilter ?? ''));
		}

		// Apply extension filter if specified
		if (options?.fileExtensions) {
			const extensions = options.fileExtensions.split(',').map(ext => ext.trim()).filter(ext => ext.length);
			filtered = filtered.filter(path => extensions.some(ext => path.endsWith(ext)));
		}

		// Apply ignore patterns (be more selective to avoid over-filtering) - EXACT MATCH TO SINGLE-THREADED
		const beforeIgnoreFilter = filtered.length;
		filtered = filtered.filter(path => {
			// More precise ignore pattern matching
			for (const pattern of IGNORE_PATTERNS) {
				if (typeof pattern === 'string') {
					// Only ignore if the pattern is a complete directory component
					if (path.includes(`/${pattern}/`) || 
						path.startsWith(`${pattern}/`) || 
						path.endsWith(`/${pattern}`) ||
						path === pattern) {
						return false;
					}
				}
			}
			
			// Additional filtering for files that shouldn't be in KG
			const fileName = path.split('/').pop()?.toLowerCase() || '';
			
			// Skip documentation and readme files
			if (fileName.includes('readme') || 
				fileName.includes('license') ||
				fileName.includes('changelog') ||
				fileName.includes('contributing') ||
				fileName.includes('authors') ||
				fileName.includes('maintainers')) {
				return false;
			}
			
			// Skip git and version control files
			if (fileName.startsWith('.git') || 
				fileName.includes('.gitignore') ||
				fileName.includes('.gitattributes')) {
				return false;
			}
			
			// Skip common non-source files
			if (fileName.includes('dockerfile') ||
				fileName.includes('docker-compose') ||
				fileName.endsWith('.md') ||
				fileName.endsWith('.txt') ||
				fileName.endsWith('.log') ||
				fileName.endsWith('.lock')) {
				return false;
			}
			
			return true;
		});

		// Apply content filter (only exclude truly empty files)
		const beforeContentFilter = filtered.length;
		const emptyFiles: string[] = [];
		filtered = filtered.filter(path => {
			const content = fileContents.get(path);
			if (!content || content.trim().length === 0) {
				emptyFiles.push(path);
				return false;
			}
			return true;
		});

		return filtered;
	}

	private isSourceFile(filePath: string): boolean {
		// Only include actual programming language source files (EXACT MATCH TO SINGLE-THREADED)
		const sourceExtensions = [
			// JavaScript/TypeScript (core web technologies)
			'.js', '.ts', '.jsx', '.tsx',
			// Python
			'.py',
			// Java
			'.java',
			// C/C++
			'.cpp', '.c', '.cc', '.cxx', '.h', '.hpp', '.hxx',
			// C#
			'.cs',
			// Only include other languages if they're commonly used
			'.php', '.rb', '.go', '.rs'
			// Removed: .mjs, .cjs (might be build artifacts)
			// Removed: .html, .htm, .xml (markup, not source code)
			// Removed: .vue, .svelte (framework-specific)
			// Removed: .kt, .scala, .swift (less common)
		];
		return sourceExtensions.some(ext => filePath.toLowerCase().endsWith(ext));
	}

	private isConfigFile(filePath: string): boolean {
		// Only include config files that might contain meaningful definitions (EXACT MATCH TO SINGLE-THREADED)
		const configFiles = [
			'package.json', 'tsconfig.json', 'jsconfig.json',
			'webpack.config.js', 'vite.config.ts', 'vite.config.js',
			'.eslintrc.js', '.eslintrc.json',
			'babel.config.js', 'rollup.config.js'
			// Removed: .prettierrc (formatting, no definitions)
			// Removed: pyproject.toml, setup.py (might be worth including if Python project)
			// Removed: requirements.txt (just dependencies)
			// Removed: Dockerfile, docker-compose.yml (deployment, not source)
			// Removed: .gitignore, .gitattributes (git config, no definitions)
			// Removed: README.md, LICENSE (documentation, no definitions)
		];
		const configExtensions = ['.json']; // Only JSON configs, removed .yaml, .yml, .toml, .ini, .cfg

		return configFiles.some(name => filePath.endsWith(name)) ||
			configExtensions.some(ext => filePath.toLowerCase().endsWith(ext));
	}

	/**
	 * Shutdown the worker pool
	 */
	public async shutdown(): Promise<void> {
		if (this.workerPool) {
			await this.workerPool.shutdown();
		}
	}

	/**
	 * Get worker pool statistics
	 */
	public getWorkerPoolStats() {
		return this.workerPool ? this.workerPool.getStats() : null;
	}

	/**
	 * Get diagnostic information about parsing results
	 */
	public getDiagnosticInfo(): {
		processedFiles: number;
		skippedFiles: number;
		totalDefinitions: number;
		definitionsByType: Record<string, number>;
		definitionsByFile: Record<string, number>;
		processingErrors: string[];
	} {
		// For now, return basic stats - can be enhanced later
		return {
			processedFiles: this.processedFiles.size,
			skippedFiles: 0, // Would need to track this during processing
			totalDefinitions: 0, // Would need to track this during processing
			definitionsByType: {}, // Would need to track this during processing
			definitionsByFile: {}, // Would need to track this during processing
			processingErrors: [] // Would need to track errors during processing
		};
	}

	/**
	 * Method to analyze a specific file (simplified version for compatibility)
	 */
	public async analyzeFile(filePath: string, content: string): Promise<{
		language: string;
		isSourceFile: boolean;
		isConfigFile: boolean;
		isCompiled: boolean;
		contentLength: number;
		queryResults: Record<string, number>;
		extractionIssues: string[];
	}> {
		const language = this.detectLanguage(filePath);
		const isSourceFile = this.isSourceFile(filePath);
		const isConfigFile = this.isConfigFile(filePath);
		const extractionIssues: string[] = [];

		if (!isSourceFile && !isConfigFile) {
			extractionIssues.push('File is not recognized as a source or config file');
		}

		if (content.trim().length === 0) {
			extractionIssues.push('File is empty');
		}

		return {
			language,
			isSourceFile,
			isConfigFile,
			isCompiled: false, // Simplified - would need proper detection
			contentLength: content.length,
			queryResults: {}, // Would need worker-based analysis for full results
			extractionIssues
		};
	}

	/**
	 * Detect programming language from file path
	 */
	private detectLanguage(filePath: string): string {
		const ext = filePath.split('.').pop()?.toLowerCase();
		switch (ext) {
			case 'ts':
			case 'tsx':
				return 'typescript';
			case 'js':
			case 'jsx':
			case 'mjs':
				return 'javascript';
			case 'py':
				return 'python';
			case 'java':
				return 'java';
			case 'cpp':
			case 'cc':
			case 'cxx':
				return 'cpp';
			case 'c':
				return 'c';
			case 'h':
			case 'hpp':
				return 'c'; // Treat headers as C for now
			default:
				return 'unknown';
		}
	}

	/**
	 * Initialize main thread parser for AST recreation
	 */
	private async initializeMainThreadParser(): Promise<void> {
		if (this.parser) return;
		
		this.parser = await initTreeSitter();

		const languageLoaders = {
			typescript: loadTypeScriptParser,
			javascript: loadJavaScriptParser,
			python: loadPythonParser,
		};

		for (const [lang, loader] of Object.entries(languageLoaders)) {
			try {
				const languageParser = await loader();
				this.languageParsers.set(lang, languageParser);
			} catch (error) {
				console.error(`Failed to load ${lang} parser:`, error);
			}
		}
	}

	/**
	 * Recreate full AST in main thread (needed for import/call processors)
	 */
	private async recreateAST(filePath: string, fileContents: Map<string, string>): Promise<void> {
		const content = fileContents.get(filePath);
		if (!content || !this.parser) return;

		const language = this.detectLanguage(filePath);
		const langParser = this.languageParsers.get(language);

		if (!langParser) return;

		try {
			this.parser.setLanguage(langParser);
			const tree = this.parser.parse(content);
			this.astMap.set(filePath, { tree });
		} catch (error) {
			console.error(`Failed to recreate AST for ${filePath}:`, error);
		}
	}
}
