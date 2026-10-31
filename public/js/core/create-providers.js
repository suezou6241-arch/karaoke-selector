import { Throttle } from './lib/throttle.js';
import { TtlCache } from './lib/cache.js';
import { createItunesProvider } from './providers/itunes.js';
import { createMusicBrainzProvider } from './providers/musicbrainz.js';

/**
 * データ提供元の組み立て場所 (ブラウザ・サーバー共通。環境変数や設定ファイルには依存しない)。
 * 提供元を変える場合は、同じメソッドを持つオブジェクトを overrides で差し替える。
 *
 *   catalog: 楽曲検索・取得 (providers/itunes.js を参照)
 *   artists: アーティストのタグ・属性・類似系統の探索 (providers/musicbrainz.js を参照)
 *
 * 呼び出し間隔の既定値は各提供元の目安 (iTunes Search 約20回/分、MusicBrainz 1回/秒) に合わせている。
 * contact はサーバーだけが渡す (ブラウザは User-Agent を設定できない)。
 */
export function createProviders({
  itunesMinIntervalMs = 1500,
  mbMinIntervalMs = 1100,
  timeoutMs = 12000,
  contact = null,
  overrides = {},
} = {}) {
  const cache = new TtlCache({ maxEntries: 800 });

  const catalog =
    overrides.catalog ??
    createItunesProvider({
      throttle: new Throttle({ minIntervalMs: itunesMinIntervalMs, maxQueue: 60 }),
      cache,
      timeoutMs,
    });

  const artists =
    overrides.artists ??
    createMusicBrainzProvider({
      throttle: new Throttle({ minIntervalMs: mbMinIntervalMs, maxQueue: 60 }),
      cache,
      timeoutMs,
      contact,
    });

  return { catalog, artists };
}
