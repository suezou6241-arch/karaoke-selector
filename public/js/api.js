import { AppError } from './core/errors.js';
import { createProviders } from './core/create-providers.js';
import { createRecommender } from './core/domain/recommend.js';
import { searchCatalog } from './core/search.js';
import { parseRecommendRequest } from './core/request.js';

/**
 * 画面から使う窓口。サーバーは介さず、この端末のブラウザが iTunes Search API / MusicBrainz を直接呼ぶ。
 * 推薦ロジックは public/js/core (サーバー版と共通) で動く。
 */

// 推薦処理全体の上限時間。超えた場合は取得できた範囲で結果を返す(候補ゼロなら再試行を促す)。
const RECOMMEND_DEADLINE_MS = 90_000;

export class ApiError extends Error {
  constructor(message, { retryable = false, code = 'unknown' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.retryable = retryable;
    this.code = code;
  }
}

const OFFLINE_MESSAGE = 'インターネットに接続されていません。接続を確認してから、もう一度お試しください。';

function toApiError(err) {
  if (err instanceof ApiError) return err;
  if (err instanceof AppError) {
    if (err.cause) console.warn(`[${err.code}]`, err.cause?.message ?? err.cause);
    return new ApiError(err.code === 'cancelled' ? 'キャンセルしました。' : err.userMessage, {
      retryable: err.retryable,
      code: err.code,
    });
  }
  console.error('[internal]', err);
  return new ApiError('予期しないエラーが発生しました。もう一度お試しください。', { retryable: true, code: 'internal' });
}

// navigator.onLine が false のときは確実にオフライン。true でも実際につながっているとは限らないので、通信失敗は別途扱う。
const isOffline = () => globalThis.navigator?.onLine === false;

/**
 * @param providers 省略時は iTunes / MusicBrainz に接続する。テストでは差し替える。
 */
export function createApi({ providers = createProviders() } = {}) {
  const recommender = createRecommender({ providers });

  async function guard(task, signal) {
    if (signal?.aborted) throw new ApiError('キャンセルしました。', { code: 'cancelled' });
    if (isOffline()) throw new ApiError(OFFLINE_MESSAGE, { retryable: true, code: 'offline' });
    try {
      return await task();
    } catch (err) {
      throw toApiError(err);
    }
  }

  return {
    searchTracks: (query, signal) => guard(() => searchCatalog({ catalog: providers.catalog, query, signal }), signal),

    recommend: (payload, signal) =>
      guard(
        () => recommender.recommend({ ...parseRecommendRequest(payload), deadlineMs: RECOMMEND_DEADLINE_MS, signal }),
        signal,
      ),
  };
}

const api = createApi();
export const searchTracks = api.searchTracks;
export const recommend = api.recommend;
