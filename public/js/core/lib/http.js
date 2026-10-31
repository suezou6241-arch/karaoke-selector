import { Errors } from '../errors.js';
import { sleep } from './sleep.js';

/**
 * 外部APIへ JSON を取得しに行く。タイムアウト、制限応答、一時障害を AppError に分類する。
 * throttle を渡すと、制限応答時に次回開始を遅らせる。
 * signal が中断されたら、通信中の要求も待機中の再試行も止めて cancelled を投げる。
 */
export async function fetchJson(url, { headers = {}, timeoutMs = 12000, retries = 1, throttle, signal } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) throw Errors.cancelled();
    try {
      return await once(url, { headers, timeoutMs, throttle, signal });
    } catch (err) {
      lastError = err;
      const retryable = ['upstream_rate_limited', 'upstream_timeout', 'network_error'].includes(err.code);
      if (!retryable || attempt === retries) break;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastError;
}

async function once(url, { headers, timeoutMs, throttle, signal }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: controller.signal });
  } catch (err) {
    if (signal?.aborted) throw Errors.cancelled();
    if (err?.name === 'AbortError') throw Errors.timeout(err);
    throw Errors.network(err);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }

  const text = await res.text().catch(() => '');
  if (signal?.aborted) throw Errors.cancelled();

  if (res.status === 429 || res.status === 503 || res.status === 403) {
    // ブラウザでは CORS により Retry-After を読めないことがある。その場合は既定の待ち時間にする。
    const retryAfter = Number.parseInt(res.headers.get('retry-after') || '', 10);
    throttle?.penalize((Number.isFinite(retryAfter) ? retryAfter : 5) * 1000);
    throw Errors.upstreamLimited(new Error(`HTTP ${res.status} ${text.slice(0, 120)}`));
  }
  if (!res.ok) throw Errors.upstream(new Error(`HTTP ${res.status} ${text.slice(0, 120)}`));

  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw Errors.upstream(err);
  }
  // MusicBrainz は制限時に 200/503 + {"error": "..."} を返すことがある
  if (json && typeof json === 'object' && typeof json.error === 'string' && !Array.isArray(json)) {
    if (/rate|exceed|limit|too many/i.test(json.error)) {
      throttle?.penalize(5000);
      throw Errors.upstreamLimited(new Error(json.error));
    }
    throw Errors.upstream(new Error(json.error));
  }
  return json;
}
