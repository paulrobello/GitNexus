# GitNexus - Fully Client sided Knowledge Graph Generator and Graph RAG Agent


GitNexus is a privacy-focused, zero-server knowledge graph generator that runs entirely in your browser. It transforms codebases into interactive knowledge graphs using advanced AST parsing, multi-threaded Web Workers, and an embedded KuzuDB WASM database. Features a Graph RAG agent for intelligent code exploration through natural language queries using cypher queries executed directly against the in-browser graph database.

https://github.com/user-attachments/assets/6f13bd45-d6e9-4f4e-a360-ceb66f41c741

## Current Work in Progress:

- Ollama support
- Export as csv ( for both node and relation table )


## Features

**Code Analysis**

- Analyze GitHub repositories or ZIP files
- Support for TypeScript, JavaScript, Python
- Interactive graph visualization with D3.js
- File filtering and directory selection
- Export results as JSON/CSV

**AI Chat**

- Multiple LLM providers (OpenAI, Anthropic, Gemini, Azure)
- Query code structure and relationships
- Context-aware conversations
- Graph-based code search

**Processing**

- Four-pass analysis: structure → parsing → imports → calls
- Parallel processing with Web Workers
- AST-based code extraction using Tree-sitter
- Memory-efficient caching

## Architecture

```mermaid
graph TB
    UI[React UI Layer] --> EM[Engine Manager]
    EM --> LEG[Legacy Engine]
    EM --> NG[Next-Gen Engine - WIP]
  
    subgraph "Legacy Engine (Production Ready)"
        LEG --> GP[Sequential Pipeline]
        GP --> SP[Single-threaded Parser]
        GP --> MEM[In-Memory Graph Store]
        MEM --> JSON[JSON Export]
    end
  
    subgraph "Next-Gen Engine (Work in Progress)"
        NG --> PP[Parallel Pipeline]
        PP --> WP[Web Worker Pool]
        PP --> KDB[KuzuDB WASM]
        KDB --> CYP[Cypher Queries]
        CYP --> RAG[Graph RAG Agent - WIP]
    end
  
    subgraph "Core Technologies"
        TS[Tree-sitter WASM]
        D3[D3.js Force Simulation]
        LC[LangChain ReAct Agents]
        IDB[IndexedDB Persistence]
    end
```

**Tech Stack**:

- **Frontend**: React 18 + TypeScript + Vite + D3.js force simulation
- **Parsing**: Tree-sitter WASM parsers (TypeScript, JavaScript, Python)
- **Concurrency**: Web Worker Pool with Comlink for thread-safe communication
- **Caching**: LRU-based AST cache with memory management and eviction policies
- **AI**: LangChain.js ReAct agents with tool-augmented reasoning
- **Database**: KuzuDB WASM integration (WIP) + IndexedDB persistence
- **Graph RAG**: Cypher query generation for knowledge graph reasoning (WIP)

## Four-Pass Ingestion Pipeline

```mermaid
flowchart TD
    START([Repository Input]) --> PASS1
  
    subgraph PASS1 ["Pass 1: Structure Analysis"]
        P1A[Recursive Directory Traversal] --> P1B[File Type Classification]
        P1B --> P1C[Project/Folder/File Nodes]
        P1C --> P1D[CONTAINS Relationships]
    end
  
    subgraph PASS2 ["Pass 2: Code Parsing & AST"]
        P2A[Tree-sitter WASM Init] --> P2B[Grammar Loading]
        P2B --> P2C[AST Generation]
        P2C --> P2D[Symbol Extraction]
        P2D --> P2E[LRU Cache Storage]
    end
  
    subgraph PASS3 ["Pass 3: Import Resolution"]
        P3A[Import Statement Extraction] --> P3B[Module Path Resolution]
        P3B --> P3C[Cross-Reference Tables]
        P3C --> P3D[IMPORTS Relationships]
    end
  
    subgraph PASS4 ["Pass 4: Call Graph Analysis"]
        P4A[Function Call Pattern Matching] --> P4B[Exact Match via Import Map]
        P4B --> P4C[Fuzzy Match + Levenshtein]
        P4C --> P4D[CALLS Relationships]
    end
  
    PASS1 --> PASS2
    PASS2 --> PASS3
    PASS3 --> PASS4
    PASS4 --> END([Knowledge Graph])
  
    classDef passBox fill:#e1f5fe,stroke:#01579b,stroke-width:2px,color:#000
    classDef startEnd fill:#c8e6c9,stroke:#2e7d32,stroke-width:3px,color:#000
    classDef step fill:#fff3e0,stroke:#ef6c00,stroke-width:1px,color:#000
  
    class PASS1,PASS2,PASS3,PASS4 passBox
    class START,END startEnd
    class P1A,P1B,P1C,P1D,P2A,P2B,P2C,P2D,P2E,P3A,P3B,P3C,P3D,P4A,P4B,P4C,P4D step
```

### Data Flow & Storage Architecture

```mermaid
flowchart TD
    START([Repository Input]) --> STRUCT[Structure Processor]
    
    STRUCT --> |Creates nodes/relationships| GRAPH1[In-Memory Graph]
    
    GRAPH1 --> PARSE[Parsing Processor]
    PARSE --> |AST Storage| AST_MAP[AST Map]
    PARSE --> |Function Registry| FUNC_TRIE[Function Trie]
    PARSE --> |Adds definition nodes| GRAPH2[Enhanced Graph]
    
    GRAPH2 --> IMPORT[Import Processor]
    AST_MAP --> IMPORT
    IMPORT --> |Import Map| IMP_MAP[Import Map]
    IMPORT --> |Adds IMPORTS relationships| GRAPH3[Graph + Imports]
    
    GRAPH3 --> CALLS[Call Processor]
    AST_MAP --> CALLS
    IMP_MAP --> CALLS
    FUNC_TRIE --> CALLS
    CALLS --> |Adds CALLS relationships| FINAL_GRAPH[Final Knowledge Graph]
    
    FINAL_GRAPH --> JSON_EXPORT[JSON Export]
    JSON_EXPORT --> |JSON.stringify| JSON_STRING[JSON String]
    JSON_STRING --> |Browser Download| FILE_SYSTEM[File System]
    
    FINAL_GRAPH --> |Direct object reference| UI[UI Components]
    
    subgraph "Storage Points"
        GRAPH1
        GRAPH2  
        GRAPH3
        FINAL_GRAPH
        AST_MAP
        FUNC_TRIE
        IMP_MAP
        JSON_STRING
    end
    
    subgraph "Cache Layer"
        LRU_CACHE[LRU Cache]
        LOCAL_STORAGE[LocalStorage]
    end
    
    PARSE -.-> LRU_CACHE
    LOCAL_STORAGE -.-> SETTINGS[Settings/Flags]
```

### Technical Implementation Details

**Pass 1: Structure Analysis**

- Implements recursive directory traversal with configurable depth limits
- File type detection using MIME types and extension mapping
- Creates hierarchical node structure with parent-child relationships
- Establishes CONTAINS relationships for project organization

**Pass 2: Code Parsing & AST Extraction**

- Initializes Tree-sitter WASM parsers with language-specific grammars
- Generates Abstract Syntax Trees for each source file
- Implements AST traversal algorithms to extract code symbols
- **LRU Cache System**: Memory-efficient AST storage with configurable eviction policies
- **Parallel Processing**: Web Worker Pool distributes parsing across multiple threads
- **Memory Management**: Automatic cleanup and garbage collection for large codebases

**Pass 3: Import Resolution**

- Extracts import/require statements using AST pattern matching
- Implements module resolution algorithms (Node.js, ES6, Python)
- Builds cross-reference tables for dependency mapping
- Handles relative/absolute path resolution with fallback strategies

**Pass 4: Call Graph Analysis**

- **Stage 1**: Exact function call matching using import resolution data
- **Stage 2**: Fuzzy matching with Levenshtein distance for unresolved calls
- **Stage 3**: Heuristic-based matching for dynamic calls and method chaining
- Creates CALLS relationships with confidence scoring

## Getting Started

**Prerequisites**: Node.js 18+, API keys for AI features

```bash
   git clone <repository-url>
   cd gitnexus
   npm install
   npm run dev
```

Open http://localhost:5173

**Configuration**

- GitHub token (optional): Increases rate limit to 5,000/hour
- AI API keys: OpenAI, Anthropic, Gemini, or Azure OpenAI
- Performance: Set file limits and directory filters

## Usage

**Analyze Repository**

1. Enter GitHub URL or upload ZIP file
2. Set filters (optional): directories, file patterns, size limits
3. Click "Analyze" and wait for processing
4. Explore the interactive graph

**AI Chat**

1. Configure API key in settings
2. Ask questions about the codebase:
   - "What functions are in main.py?"
   - "Show classes that inherit from BaseClass"
   - "How does authentication work?"

**Export Data**

- Click Export button to download graph as JSON/CSV

## Advanced Features & Work in Progress

### Web Worker Pool Architecture

```mermaid
graph LR
    MT[Main Thread] --> WM[Worker Manager]
    WM --> W1[Worker 1<br/>Tree-sitter Parser]
    WM --> W2[Worker 2<br/>Tree-sitter Parser]
    WM --> W3[Worker N<br/>Tree-sitter Parser]
  
    W1 --> AST1[AST Cache]
    W2 --> AST2[AST Cache]
    W3 --> AST3[AST Cache]
  
    AST1 --> LRU[LRU Eviction Policy]
    AST2 --> LRU
    AST3 --> LRU
```

### LRU Cache Implementation

- **Memory-bounded AST storage** with configurable size limits (default: 1000 entries)
- **Automatic eviction policies** based on access patterns and memory pressure
- **Thread-safe operations** across Web Worker boundaries using Comlink
- **Cache hit optimization** for repeated file analysis and import resolution
- **Garbage collection integration** with browser memory management APIs

### KuzuDB Integration Status (Work in Progress)

```mermaid
graph TD
    APP[Application Layer] --> RAG[Graph RAG Agent]
    RAG --> CYP[Cypher Query Generator]
    CYP --> KDB[KuzuDB WASM Engine]
    KDB --> IDB[IndexedDB Persistence]
  
    subgraph STATUS ["Current Status"]
        IMPL[KuzuDB WASM Integration - Complete]
        PERS[IndexedDB Persistence - Complete]
        SCHEMA[Graph Schema Definition - Complete]
        QUERY[Cypher Query Execution - WIP]
        AGENT[Graph RAG Agent - WIP]
    end
  
    classDef complete fill:#c8e6c9,stroke:#2e7d32,stroke-width:2px
    classDef wip fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef main fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
  
    class IMPL,PERS,SCHEMA complete
    class QUERY,AGENT wip
    class APP,RAG,CYP,KDB,IDB main
```

**Implementation Status**:

- ✅ **KuzuDB WASM Engine**: Fully integrated embedded graph database
- ✅ **Graph Schema**: Node and relationship type definitions implemented
- ✅ **Data Ingestion**: Knowledge graph storage in KuzuDB format
- 🚧 **Cypher Query Engine**: Query execution layer under development
- 🚧 **Graph RAG Agent**: AI agent with graph querying capabilities (blocked by Cypher integration)

**Current Limitation**: The Graph RAG agent cannot execute sophisticated graph queries because the Cypher query execution layer is still being implemented. Basic AI chat works with in-memory graph traversal, but advanced graph reasoning requires the KuzuDB Cypher integration to be completed.

### Dual-Engine Architecture

- **Legacy Engine**: Production-ready single-threaded processing with JSON storage
- **Next-Gen Engine**: Parallel processing with KuzuDB persistence (4-8x performance improvement)
- **Automatic Fallback**: System gracefully degrades to legacy engine if next-gen fails
- **Runtime Switching**: Users can toggle between engines without data loss

## Deployment

```bash
npm run build
npm run preview
```

**Environment Variables**

```env
VITE_OPENAI_API_KEY=sk-...
VITE_DEFAULT_MAX_FILES=500
VITE_ENABLE_DEBUG_LOGGING=false
```

## Security & Privacy

- All processing happens in your browser
- API keys stored locally, never transmitted
- No code or results stored remotely
- Uses GitHub public API only

## Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/name`
3. Make changes and test
4. Commit: `git commit -m 'Add feature'`
5. Push and open Pull Request

**Code Style**: TypeScript strict mode, ESLint rules, minimal comments

## License

MIT License - see [LICENSE](LICENSE) file

## Acknowledgments

- Tree-sitter for syntax parsing
- LangChain.js for AI agents
- D3.js for graph visualization
- KuzuDB for embedded database
- [code-graph-rag](https://github.com/vitali87/code-graph-rag) for reference implementation
