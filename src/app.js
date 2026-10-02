import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTORS } from './tickers.js';

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, { 'Content-Type': type, ...extra });
  res.end(body);
}

export function createApp(store) {
  return http.createServer(async (req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return send(res, 400, 'text/plain; charset=utf-8', 'Pedido inválido');
    }

    if (pathname === '/api/quotes') {
      const body = JSON.stringify({
        serverTime: Date.now(),
        sectors: SECTORS,
        quotes: store.snapshot(),
      });
      return send(res, 200, 'application/json; charset=utf-8', body, { 'Cache-Control': 'no-store' });
    }

    const file = resolve(PUBLIC, `.${pathname === '/' ? '/index.html' : pathname}`);
    const type = TYPES[extname(file)];
    if (!file.startsWith(PUBLIC + sep) || !type) {
      return send(res, 404, 'text/plain; charset=utf-8', 'Não encontrado');
    }
    try {
      return send(res, 200, type, await readFile(file));
    } catch {
      return send(res, 404, 'text/plain; charset=utf-8', 'Não encontrado');
    }
  });
}
