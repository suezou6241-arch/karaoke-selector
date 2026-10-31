import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 依存パッケージを増やさないための簡易 .env 読み込み。既に設定済みの環境変数は上書きしない。
function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadDotEnv(path.join(ROOT_DIR, '.env'));

function int(name, def, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export const config = Object.freeze({
  port: int('PORT', 3000, 0, 65535),
  host: process.env.HOST || '127.0.0.1',
  trustProxy: process.env.TRUST_PROXY === '1',
  publicDir: path.join(ROOT_DIR, 'public'),

  mbContact: process.env.MB_CONTACT || 'https://example.com/contact-replace-me',
  mbMinIntervalMs: int('MB_MIN_INTERVAL_MS', 1100, 500, 10000),
  itunesMinIntervalMs: int('ITUNES_MIN_INTERVAL_MS', 1500, 300, 10000),
  upstreamTimeoutMs: int('UPSTREAM_TIMEOUT_MS', 12000, 2000, 60000),

  rateLimitPerMin: int('RATE_LIMIT_PER_MIN', 40, 5, 1000),
  maxConcurrentRecommend: int('MAX_CONCURRENT_RECOMMEND', 2, 1, 10),
  maxQueuedRecommend: int('MAX_QUEUED_RECOMMEND', 6, 0, 100),

  // 推薦処理全体の上限時間。超えた場合は利用者に再試行を促す。
  recommendDeadlineMs: int('RECOMMEND_DEADLINE_MS', 90000, 10000, 300000),
});
