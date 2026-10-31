import { Errors } from './errors.js';
import { normalizeMode } from './domain/recommend.js';

export const TRACK_ID = /^itunes:\d{1,12}$/;
const MAX_EXCLUDE = 200;

const isTrackId = (v) => typeof v === 'string' && TRACK_ID.test(v);

/**
 * 推薦リクエストを検証して正規化する (サーバー・ブラウザ共通)。
 * 不正な入力は badRequest として拒否する (FR-02: 参考曲は必ず異なる2曲)。
 */
export function parseRecommendRequest(body) {
  const ids = body?.trackIds;
  if (!Array.isArray(ids) || ids.length !== 2 || !ids.every(isTrackId)) {
    throw Errors.badRequest('参考曲を2曲選んでください。');
  }
  if (ids[0] === ids[1]) throw Errors.badRequest('同じ曲が2回選ばれています。別の曲を選んでください。');

  let excludeTrackIds = [];
  if (body.excludeTrackIds !== undefined) {
    const ex = body.excludeTrackIds;
    if (!Array.isArray(ex) || ex.length > MAX_EXCLUDE || !ex.every(isTrackId)) {
      throw Errors.badRequest('除外する曲の指定が正しくありません。');
    }
    excludeTrackIds = ex;
  }

  return {
    trackIds: ids,
    count: body.count === 10 ? 10 : 5,
    mode: normalizeMode(body.mode),
    excludeTrackIds,
  };
}
