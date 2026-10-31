import { config } from '../config.js';
import { createProviders as createCoreProviders } from '../../public/js/core/create-providers.js';

/**
 * サーバー用のデータ提供元。ブラウザと同じ実装 (public/js/core) に、環境変数由来の設定を渡す。
 * テストなどで提供元を差し替える場合は overrides に { catalog, artists } を渡す。
 */
export function createProviders(overrides = {}) {
  return createCoreProviders({
    itunesMinIntervalMs: config.itunesMinIntervalMs,
    mbMinIntervalMs: config.mbMinIntervalMs,
    timeoutMs: config.upstreamTimeoutMs,
    contact: config.mbContact,
    overrides,
  });
}
