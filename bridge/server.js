#!/usr/bin/env node
// FireScrape Bridge Server
// HTTP API locale su localhost:9222 ↔ Chrome Native Messaging
// Qualsiasi software esterno può controllare FireScrape via REST API

const http = require('http');
const path = require('path');

// ============================================================
// NATIVE MESSAGING PROTOCOL
// ============================================================
// Chrome invia/riceve messaggi con un header di 4 byte (lunghezza) + JSON

let pendingRequests = new Map(); // requestId → { resolve, reject, timeout }
let requestCounter = 0;

function sendToExtension(message) {
  return new Promise((resolve, reject) => {
    const id = ++requestCounter;
    message._bridgeId = id;

    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error('Timeout: extension did not respond within 30s'));
    }, 30000);

    pendingRequests.set(id, { resolve, reject, timeout });

    const json = JSON.stringify(message);
    const header = Buffer.alloc(4);
    header.writeUInt32LE(Buffer.byteLength(json, 'utf8'), 0);

    try {
      process.stdout.write(header);
      process.stdout.write(json);
    } catch (err) {
      pendingRequests.delete(id);
      clearTimeout(timeout);
      reject(new Error('Failed to send to extension: ' + err.message));
    }
  });
}

// Leggi messaggi da Chrome (stdin)
let inputBuffer = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);

  while (inputBuffer.length >= 4) {
    const messageLength = inputBuffer.readUInt32LE(0);
    if (inputBuffer.length < 4 + messageLength) break; // attendi più dati

    const jsonStr = inputBuffer.slice(4, 4 + messageLength).toString('utf8');
    inputBuffer = inputBuffer.slice(4 + messageLength);

    try {
      const message = JSON.parse(jsonStr);
      handleExtensionMessage(message);
    } catch (err) {
      log('Error parsing extension message:', err.message);
    }
  }
});

function handleExtensionMessage(message) {
  const id = message._bridgeId;
  if (id && pendingRequests.has(id)) {
    const { resolve, timeout } = pendingRequests.get(id);
    clearTimeout(timeout);
    pendingRequests.delete(id);
    delete message._bridgeId;
    resolve(message);
  }
}

// ============================================================
// HTTP SERVER — REST API
// ============================================================
const PORT = parseInt(process.env.FIRESCRAPE_PORT || '9222');
const API_KEY = process.env.FIRESCRAPE_API_KEY || ''; // opzionale

function log(...args) {
  process.stderr.write('[FireScrape Bridge] ' + args.join(' ') + '\n');
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const maxSize = 5 * 1024 * 1024; // 5MB max

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxSize) {
        reject(new Error('Request body too large (max 5MB)'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
  });
  res.end(json);
}

// API Routes
const ROUTES = {
  // Scraping
  'POST /api/scrape':         (body) => sendToExtension({ action: 'scrape', ...body }),
  'POST /api/crawl/start':    (body) => sendToExtension({ action: 'crawl-start', ...body }),
  'POST /api/crawl/stop':     ()     => sendToExtension({ action: 'crawl-stop' }),
  'GET  /api/crawl/status':   ()     => sendToExtension({ action: 'crawl-status' }),
  'POST /api/map':            (body) => sendToExtension({ action: 'map', ...body }),
  'POST /api/batch':          (body) => sendToExtension({ action: 'batch', ...body }),
  'POST /api/screenshot':     (body) => sendToExtension({ action: 'screenshot', ...body }),
  'POST /api/extract':        (body) => sendToExtension({ action: 'extract', ...body }),

  // Agent
  'POST /api/agent/action':   (body) => sendToExtension({ action: 'agent-action', ...body }),
  'POST /api/agent/sequence': (body) => sendToExtension({ action: 'agent-sequence', ...body }),
  'GET  /api/agent/snapshot': ()     => sendToExtension({ action: 'agent-snapshot' }),

  // Brain
  'POST /api/brain/analyze':  ()     => sendToExtension({ action: 'brain-analyze' }),
  'POST /api/brain/think':    (body) => sendToExtension({ action: 'brain-think', ...body }),
  'GET  /api/brain/stats':    ()     => sendToExtension({ action: 'brain-stats' }),
  'POST /api/brain/config':   (body) => sendToExtension({ action: 'brain-config', ...body }),
  'GET  /api/brain/config':   ()     => sendToExtension({ action: 'brain-get-config' }),

  // Library
  'GET  /api/library/search': (body) => sendToExtension({ action: 'library-search', ...body }),
  'GET  /api/library/export': ()     => sendToExtension({ action: 'library-export' }),
  'POST /api/library/clear':  ()     => sendToExtension({ action: 'library-clear' }),

  // Relay
  'POST /api/relay/start':    ()     => sendToExtension({ action: 'relay-start' }),
  'POST /api/relay/stop':     ()     => sendToExtension({ action: 'relay-stop' }),
  'GET  /api/relay/status':   ()     => sendToExtension({ action: 'relay-status' }),

  // Stats
  'GET  /api/cache/stats':    ()     => sendToExtension({ action: 'cache-stats' }),
  'POST /api/cache/clear':    ()     => sendToExtension({ action: 'cache-clear' }),
  'POST /api/cache/cleanup':  ()     => sendToExtension({ action: 'cache-cleanup' }),
  'GET  /api/rate/stats':     ()     => sendToExtension({ action: 'rate-stats' }),

  // TaskRunner
  'POST /api/task/create':    (body) => sendToExtension({ action: 'task-create', ...body }),
  'POST /api/task/start':     (body) => sendToExtension({ action: 'task-start', ...body }),
  'POST /api/task/pause':     (body) => sendToExtension({ action: 'task-pause', ...body }),
  'POST /api/task/cancel':    (body) => sendToExtension({ action: 'task-cancel', ...body }),
  'POST /api/task/retry':     (body) => sendToExtension({ action: 'task-retry', ...body }),
  'GET  /api/task/status':    (body) => sendToExtension({ action: 'task-status', ...body }),
  'GET  /api/task/list':      (body) => sendToExtension({ action: 'task-list', ...body }),
  'GET  /api/task/stats':     ()     => sendToExtension({ action: 'task-stats' }),

  // FileManager
  'POST /api/file/download':  (body) => sendToExtension({ action: 'file-download', ...body }),
  'GET  /api/file/list':      (body) => sendToExtension({ action: 'file-list', ...body }),
  'GET  /api/file/search':    (body) => sendToExtension({ action: 'file-search', ...body }),
  'POST /api/file/redownload':(body) => sendToExtension({ action: 'file-redownload', ...body }),
  'GET  /api/file/stats':     ()     => sendToExtension({ action: 'file-stats' }),

  // Connectors
  'GET  /api/connector/list': ()     => sendToExtension({ action: 'connector-list' }),
  'POST /api/connector/config':(body)=> sendToExtension({ action: 'connector-configure', ...body }),
  'POST /api/connector/exec': (body) => sendToExtension({ action: 'connector-execute', ...body }),
  'POST /api/connector/test': (body) => sendToExtension({ action: 'connector-test', ...body }),

  // Pipeline
  'POST /api/pipeline/save':  (body) => sendToExtension({ action: 'pipeline-save', ...body }),
  'GET  /api/pipeline/load':  (body) => sendToExtension({ action: 'pipeline-load', ...body }),
  'GET  /api/pipeline/list':  ()     => sendToExtension({ action: 'pipeline-list' }),
  'POST /api/pipeline/exec':  (body) => sendToExtension({ action: 'pipeline-execute', ...body }),
  'POST /api/pipeline/delete':(body) => sendToExtension({ action: 'pipeline-delete', ...body }),
  'GET  /api/pipeline/templates':()  => sendToExtension({ action: 'pipeline-templates' }),
  'GET  /api/pipeline/stats': ()     => sendToExtension({ action: 'pipeline-stats' }),

  // ElevenLabs
  'GET  /api/el/config':      ()     => sendToExtension({ action: 'el-config-get' }),
  'POST /api/el/config':      (body) => sendToExtension({ action: 'el-config-set', ...body }),
  'GET  /api/el/voices':      (body) => sendToExtension({ action: 'el-voices', ...body }),
  'POST /api/el/voice/search':(body) => sendToExtension({ action: 'el-voice-search', ...body }),
  'POST /api/el/voice/preview':(body)=> sendToExtension({ action: 'el-voice-preview', ...body }),
  'GET  /api/el/models':      ()     => sendToExtension({ action: 'el-models' }),
  'POST /api/el/speak':       (body) => sendToExtension({ action: 'el-speak', ...body }),
  'POST /api/el/speak-page':  (body) => sendToExtension({ action: 'el-speak-page', ...body }),
  'POST /api/el/transcribe':  (body) => sendToExtension({ action: 'el-transcribe', ...body }),
  'GET  /api/el/agents':      ()     => sendToExtension({ action: 'el-agent-local-list' }),
  'POST /api/el/agent/create':(body) => sendToExtension({ action: 'el-agent-local-save', ...body }),
  'POST /api/el/agent/delete':(body) => sendToExtension({ action: 'el-agent-local-remove', ...body }),
  'GET  /api/el/stats':       ()     => sendToExtension({ action: 'el-stats' }),
  'GET  /api/el/history':     (body) => sendToExtension({ action: 'el-history', ...body }),
  'GET  /api/el/languages':   ()     => sendToExtension({ action: 'el-languages' }),

  // Meta
  'GET  /api/health':         ()     => Promise.resolve({ ok: true, version: '3.2.0', uptime: process.uptime() }),
  'GET  /api/actions':        ()     => Promise.resolve({ actions: Object.keys(ROUTES).map(r => r.replace(/\s+/g, ' ')) }),
};

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  // API Key check (se configurato)
  if (API_KEY) {
    const provided = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
    if (provided !== API_KEY) {
      sendJson(res, 401, { error: 'Invalid API key' });
      return;
    }
  }

  // Trova route
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const routeKey = `${req.method.toUpperCase().padEnd(4)} ${url.pathname}`;

  // Match route (trim spaces)
  const handler = ROUTES[routeKey] || ROUTES[routeKey.replace(/\s+/g, ' ')];

  if (!handler) {
    // Try with flexible method matching
    const getKey = `GET  ${url.pathname}`;
    const postKey = `POST ${url.pathname}`;
    const flexHandler = ROUTES[getKey] || ROUTES[postKey];

    if (flexHandler) {
      try {
        const body = req.method === 'GET'
          ? Object.fromEntries(url.searchParams)
          : await parseBody(req);
        const result = await flexHandler(body);
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return;
    }

    sendJson(res, 404, { error: 'Not found', available: '/api/actions' });
    return;
  }

  try {
    const body = req.method === 'GET'
      ? Object.fromEntries(url.searchParams)
      : await parseBody(req);
    const result = await handler(body);
    sendJson(res, 200, result);
  } catch (err) {
    const status = err.message.includes('Timeout') ? 504 : 500;
    sendJson(res, status, { error: err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  log(`Server listening on http://127.0.0.1:${PORT}`);
  log(`API docs: http://127.0.0.1:${PORT}/api/actions`);
  if (API_KEY) log('API key authentication enabled');
});

// Graceful shutdown
process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT', () => { server.close(); process.exit(0); });

// Keep alive — Chrome chiude il processo se non c'è I/O
process.stdin.resume();
process.stdin.on('end', () => {
  log('Extension disconnected, shutting down');
  server.close();
  process.exit(0);
});
