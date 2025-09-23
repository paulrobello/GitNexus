/**
 * Simple HTTP server to serve the KuzuDB FS test HTML file
 * This ensures proper CORS and module loading for the test
 */

import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { extname, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 3000;

// MIME types
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm'
};

const server = createServer((req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  let filePath = req.url === '/' ? '/kuzuFStest.html' : req.url;
  filePath = join(__dirname, filePath);

  // Security check - prevent directory traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end('File not found');
    return;
  }

  try {
    const ext = extname(filePath);
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    
    const content = readFileSync(filePath);
    
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
    
  } catch (error) {
    console.error('Error serving file:', error);
    res.writeHead(500);
    res.end('Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Test server running at http://localhost:${PORT}`);
  console.log(`📝 Open http://localhost:${PORT} to run the KuzuDB FS COPY test`);
  console.log(`🛑 Press Ctrl+C to stop the server`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
