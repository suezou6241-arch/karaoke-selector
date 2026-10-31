import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { AppError, Errors } from '../public/js/core/errors.js';
import { createRateLimiter } from './lib/ratelimit.js';
import { JobQueue } from './lib/jobqueue.js';
import { createProviders } from './providers/index.js';
import { createRecommender } from '../public/js/core/domain/recommend.js';
import { searchCatalog } from '../public/js/core/search.js';
import { parseRecommendRequest } from '../public/js/core/request.js';

const MAX_BODY_BYTES = 8 * 1024;

// 画面(ブラウザ)は iTunes Search API と MusicBrainz を直接呼ぶため、connect-src に許可が必要。
// index.html の <meta http-equiv="Content-Security-Policy"> と同じ内容にしておくこと (scripts/smoke.js が検査する)。
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "connect-src 'self' https://itunes.apple.com https://musicbrainz.org; " +
    "base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
    ...extraHeaders,
  });
  res.end(payload);
}

function sendError(res, err) {
  if (err instanceof AppError) {
    if (err.cause) console.warn(`[${err.code}]`, err.cause?.message ?? err.cause);
    return sendJson(res, err.status, {
      error: { code: err.code, message: err.userMessage, retryable: err.retryable },
    });
  }
  console.error('[internal]', err);
  const e = Errors.internal(err);
  return sendJson(res, e.status, { error: { code: e.code, message: e.userMessage, retryable: true } });
}

async function readJsonBody(req) {
  const type = String(req.headers['content-type'] ?? '');
  if (!type.toLowerCase().startsWith('application/json')) throw Errors.badRequest('リクエストの形式が正しくありません。');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Errors.badRequest('リクエストが大きすぎます。');
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    return parsed;
  } catch {
    throw Errors.badRequest('リクエストの内容を読み取れませんでした。');
  }
}

function clientKey(req) {
  if (config.trustProxy) {
    const xff = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    if (xff) return xff;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export function createApp({ providers = createProviders() } = {}) {
  // KS_DEBUG=1 のときだけ内部スコアを返す (配点調整用)
  const recommender = createRecommender({ providers, debug: Boolean(process.env.KS_DEBUG) });
  const limiter = createRateLimiter({ limit: config.rateLimitPerMin, windowMs: 60_000 });
  const queue = new JobQueue({ concurrency: config.maxConcurrentRecommend, maxQueued: config.maxQueuedRecommend });

  async function handleSearch(url, res) {
    const result = await searchCatalog({ catalog: providers.catalog, query: url.searchParams.get('q') });
    sendJson(res, 200, result);
  }

  async function handleRecommend(req, res) {
    const request = parseRecommendRequest(await readJsonBody(req));
    const result = await queue.run(() => recommender.recommend({ ...request, deadlineMs: config.recommendDeadlineMs }));
    sendJson(res, 200, result);
  }

  async function serveStatic(url, res) {
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      throw Errors.badRequest('URLが正しくありません。');
    }
    if (rel.includes('\0')) throw Errors.badRequest('URLが正しくありません。');
    if (rel.endsWith('/')) rel += 'index.html';
    const full = path.resolve(config.publicDir, `.${path.sep}${rel}`);
    const base = path.resolve(config.publicDir) + path.sep;
    const isDotfile = full.split(path.sep).some((seg) => seg.startsWith('.') && seg.length > 1);
    if (!full.startsWith(base) || isDotfile) throw Errors.notFound('ページが見つかりません。');

    let file = full;
    try {
      const s = await stat(file);
      if (s.isDirectory()) file = path.join(file, 'index.html');
    } catch {
      throw Errors.notFound('ページが見つかりません。');
    }
    const data = await readFile(file).catch(() => {
      throw Errors.notFound('ページが見つかりません。');
    });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
      ...SECURITY_HEADERS,
    });
    res.end(data);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname === '/api/health') return sendJson(res, 200, { ok: true });
        const verdict = limiter.check(clientKey(req));
        if (!verdict.ok) {
          res.setHeader?.('Retry-After', String(verdict.retryAfterSec));
          throw Errors.tooManyRequests(verdict.retryAfterSec);
        }
        if (req.method === 'GET' && url.pathname === '/api/search') return await handleSearch(url, res);
        if (req.method === 'POST' && url.pathname === '/api/recommend') return await handleRecommend(req, res);
        throw Errors.notFound('APIが見つかりません。');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD', ...SECURITY_HEADERS });
        return res.end();
      }
      return await serveStatic(url, res);
    } catch (err) {
      if (res.headersSent) return res.destroy();
      if (!req.url?.startsWith('/api/') && err instanceof AppError) {
        const body = `${err.userMessage}`;
        res.writeHead(err.status, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
        return res.end(body);
      }
      return sendError(res, err);
    }
  });

  server.headersTimeout = 15_000;
  server.requestTimeout = 120_000;
  return server;
}
