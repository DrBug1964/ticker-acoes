import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ValidationError } from './settings.js';

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};
const MAX_BODY = 64 * 1024;

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, { 'Content-Type': type, ...extra });
  res.end(body);
}
const sendJson = (res, status, obj) =>
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(obj), { 'Cache-Control': 'no-store' });

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new ValidationError('Pedido demasiado grande');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ValidationError('JSON inválido');
  }
}

export function createApp(service) {
  const server = http.createServer(async (req, res) => {
    const port = server.address()?.port;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    const origin = req.headers.origin;
    if (!hosts.includes(req.headers.host) || (origin !== undefined && !hosts.some((h) => origin === `http://${h}`))) {
      return sendJson(res, 403, { error: 'Acesso recusado' });
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return sendJson(res, 400, { error: 'Pedido inválido' });
    }

    if (pathname.startsWith('/api/')) {
      try {
        return await handleApi(req, res, pathname);
      } catch (err) {
        if (err instanceof ValidationError) return sendJson(res, 400, { error: err.message });
        console.warn(`erro interno em ${pathname}: ${err.message}`);
        return sendJson(res, 500, { error: 'Erro interno' });
      }
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

  async function handleApi(req, res, pathname) {
    const { method } = req;
    const url = new URL(req.url, 'http://localhost');

    if (pathname === '/api/quotes' && method === 'GET') {
      return sendJson(res, 200, service.quotesPayload());
    }

    if (pathname === '/api/search' && method === 'GET') {
      try {
        const results = await service.search(
          url.searchParams.get('q') ?? '',
          url.searchParams.get('market') ?? 'all',
        );
        return sendJson(res, 200, { results });
      } catch (err) {
        if (err instanceof ValidationError) throw err;
        if (err.rateLimited) {
          return sendJson(res, 429, { error: 'Limite de pedidos da fonte de dados. Tente daqui a pouco.' });
        }
        return sendJson(res, 502, { error: err.message });
      }
    }

    if (pathname === '/api/watchlist') {
      if (method === 'GET') return sendJson(res, 200, { items: service.getWatchlist() });
      if (method === 'PUT') {
        const body = await readJson(req);
        if (!body || !('items' in body)) throw new ValidationError('Falta o campo "items"');
        return sendJson(res, 200, { items: service.setWatchlist(body.items) });
      }
    }

    if (pathname === '/api/settings') {
      if (method === 'GET') return sendJson(res, 200, service.getSettings());
      if (method === 'PUT') return sendJson(res, 200, service.updateSettings(await readJson(req)));
    }

    return sendJson(res, 404, { error: 'Não encontrado' });
  }

  return server;
}
