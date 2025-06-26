const http = require('http');
const fs = require('fs');
const path = require('path');

// Define the port
const PORT = 8000;

// Define the web directory path
const WEB_DIR = path.join(__dirname, 'web');

// MIME types for different file extensions
const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.wasm': 'application/wasm',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

// Create the HTTP server
const server = http.createServer((req, res) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    
    // Parse the URL
    let filePath = req.url === '/' ? '/index.html' : req.url;
    
    // Remove query parameters if any
    filePath = filePath.split('?')[0];
    
    // Construct the full file path
    const fullPath = path.join(WEB_DIR, filePath);
    
    console.log(`Looking for file: ${fullPath}`);
    
    // Get the file extension
    const ext = path.extname(filePath).toLowerCase();
    
    // Get the MIME type
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
    
    // Check if file exists and serve it
    fs.readFile(fullPath, (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                // File not found
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404 - File Not Found');
                console.log(`404 - File not found: ${fullPath}`);
            } else {
                // Server error
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('500 - Internal Server Error');
                console.error(`500 - Server error: ${err.message}`);
            }
        } else {
            // Set CORS headers to allow cross-origin requests (needed for WASM and workers)
            res.writeHead(200, {
                'Content-Type': mimeType,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Cross-Origin-Embedder-Policy': 'require-corp',
                'Cross-Origin-Opener-Policy': 'same-origin'
            });
            res.end(data);
            console.log(`200 - Served: ${fullPath} (${mimeType})`);
        }
    });
});

// Start the server
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
    console.log(`Serving files from: ${WEB_DIR}`);
    console.log('Press Ctrl+C to stop the server');
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
