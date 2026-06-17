import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ChatRequestSchema } from './schemas.ts';
import { runAgentLoop } from './agent.ts';

const PORT = Number(process.env['PORT'] ?? 3000);
const REQUEST_TIMEOUT_MS = 300_000;
const SSE_KEEPALIVE_MS = 15_000;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

async function serveStatic(
  res: ServerResponse,
  filePath: string
): Promise<void> {
  try {
    const content = await readFile(filePath);
    const ext = filePath.slice(filePath.lastIndexOf('.'));
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
    });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

async function handleChat(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const body = await readBody(req);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  const validation = ChatRequestSchema.safeParse(parsed);
  if (!validation.success) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'Validation failed',
        details: validation.error.issues,
      })
    );
    return;
  }

  const ac = new AbortController();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff',
  });

  res.flushHeaders();

  const keepAlive = setInterval(() => {
    if (!res.writableEnded) {
      res.write('\n');
    }
  }, SSE_KEEPALIVE_MS);

  req.on('close', () => {
    ac.abort();
    clearInterval(keepAlive);
  });

  req.on('error', () => {
    ac.abort();
    clearInterval(keepAlive);
  });

  const write = (event: Record<string, unknown>): boolean | void => {
    if (res.writableEnded || res.destroyed) {
      ac.abort();
      return false;
    }
    const data = JSON.stringify(event);
    return res.write(data + '\n');
  };

  const timer = setTimeout(() => {
    ac.abort();
    if (!res.writableEnded) {
      res.write(
        JSON.stringify({ type: 'error', message: 'Request timeout' }) + '\n'
      );
      res.end();
    }
  }, REQUEST_TIMEOUT_MS);

  try {
    await runAgentLoop(validation.data.messages, write, ac.signal);
  } catch (err) {
    console.error('Chat handler error:', err);
  } finally {
    clearTimeout(timer);
    clearInterval(keepAlive);
    if (!res.writableEnded) {
      res.end();
    }
  }
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (method === 'GET') {
    const staticDir = join(
      import.meta.dirname ?? process.cwd(),
      '..',
      'public'
    );
    if (url.startsWith('/downloads/')) {
      serveStatic(res, join(staticDir, url)).catch(() => {
        res.writeHead(500);
        res.end('Internal Server Error');
      });
      return;
    }

    const staticRoutes: Record<string, string> = {
      '/': 'index.html',
      '/index.html': 'index.html',
      '/styles.css': 'styles.css',
      '/app.js': 'app.js',
    };

    const file = staticRoutes[url];
    if (file) {
      serveStatic(res, join(staticDir, file)).catch(() => {
        res.writeHead(500);
        res.end('Internal Server Error');
      });
      return;
    }
  }

  if (method === 'POST' && url === '/api/chat') {
    handleChat(req, res).catch((err) => {
      console.error('Chat error:', err);
      if (!res.headersSent)
        res.writeHead(500, { 'Content-Type': 'application/json' });
      if (!res.writableEnded)
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
}

export function startServer(): void {
  const server = createServer(handleRequest);

  server.timeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = 30_000;
  server.keepAliveTimeout = 10_000;

  server.listen(PORT, () => {
    console.log(`Sandbox Agent running at http://localhost:${PORT}`);
  });
}
