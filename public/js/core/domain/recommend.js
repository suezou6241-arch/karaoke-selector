import { Errors } from '../errors.js';
import { GENRES } from './taxonomy.js';
import {
  titleKey,
  artistKey,
  primaryArtistName,
  isAlternateVersion,
} from './normalize.js';
import { buildProfile, artistGenreVector, expandGenres, topKeys } from './profile.js';
import { cosine, similarity, baseScore } from './similarity.js';
import { buildReason, summarizeSeeds, describeSeedProfile } from './reasons.js';

// ---- 調整用の定数 (仕様書 5.1〜5.4 の初期値。評価結果に基づいて見直す) ----
const MIN_BASE = 0.38; // 候補として採用する基礎スコアの下限
const MIN_FLOOR = 0.22; // 片方の参考曲への類似度の下限(意外性枠も満たす)
const SURPRISE_MIN_BASE = 0.6; // 意外性枠でも、入力曲との共通性は保つ
const SURPRISE_MIN_NEAR = 0.2; // 入力曲のアーティスト系統と全く無関係な候補は意外性枠にもしない
// 年代の補正 (仕様書 2章「同年代は発売年が近いことを基本とする」)。
// ジャンル情報が乏しい参考曲では、年代が大きく離れてもジャンル一致だけで基礎スコアが残るため、
// 候補の発売年が参考曲の年代範囲から ERA_GRACE_YEARS を超えて離れた分だけ基礎スコアを減らす。
const ERA_GRACE_YEARS = 5;
const ERA_FIT_SLOPE = 0.03; // 1年離れるごとの減衰
const ERA_FIT_FLOOR = 0.55;
const TRACKS_PER_ARTIST = 15;
const MAX_ROUNDS = 4;
const MAX_ARTISTS = 32;
const POOL_TTL_MS = 20 * 60_000;
const MODES = new Set(['balanced', 'classic', 'surprise']);

const GENERIC_GENRES = new Set(['pop', 'children']);

// 実測(邦楽バンド同士の組み合わせ)では本命候補が 0.8〜0.9 に集まるため、段階の境目はそれに合わせている。
const matchLevelOf = (base) => (base >= 0.88 ? 5 : base >= 0.78 ? 4 : base >= 0.65 ? 3 : base >= 0.5 ? 2 : 1);
const closenessOf = (s) =>
  s >= 0.7 ? { level: 4, label: 'とても近い' } : s >= 0.55 ? { level: 3, label: '近い' } : s >= 0.4 ? { level: 2, label: 'やや近い' } : { level: 1, label: '部分的に近い' };

/** 候補の発売年が参考曲の年代範囲 [最小, 最大] からどれだけ外れているかに応じた係数 (0〜1)。年が不明なら 1。 */
export function eraFit(candidateYear, seedYears) {
  const known = seedYears.filter(Boolean);
  if (!candidateYear || known.length === 0) return 1;
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  const dist = Math.max(0, lo - candidateYear, candidateYear - hi);
  return Math.max(ERA_FIT_FLOOR, 1 - ERA_FIT_SLOPE * Math.max(0, dist - ERA_GRACE_YEARS));
}

export function normalizeMode(mode) {
  return MODES.has(mode) ? mode : 'balanced';
}

/**
 * @param providers  { catalog, artists } (create-providers.js)
 * @param debug      true のとき、各候補に内部スコアを付けて返す (配点調整用。画面には表示しない)
 */
export function createRecommender({ providers, debug = false }) {
  const { catalog, artists } = providers;
  const pools = new Map();

  function sweepPools() {
    const now = Date.now();
    for (const [k, p] of pools) if (p.expiresAt <= now) pools.delete(k);
    while (pools.size > 40) pools.delete(pools.keys().next().value);
  }

  // ---------- 参考曲の読み込み ----------
  async function loadSeeds(trackIds, signal) {
    const found = await catalog.lookupTracks(trackIds, { signal });
    const byId = new Map(found.map((t) => [t.trackId, t]));
    const tracks = trackIds.map((id) => byId.get(id));
    if (tracks.some((t) => !t)) {
      throw Errors.notFound('参考曲の情報を取得できませんでした。曲を選び直してください。');
    }
    return tracks;
  }

  async function buildSeed(track, degraded, signal) {
    let artist = null;
    try {
      artist = await artists.findArtist(primaryArtistName(track.artistName), { signal });
    } catch (err) {
      if (err?.code === 'busy' || err?.code === 'cancelled') throw err;
      degraded.add('artist_lookup');
    }
    return { track, artist, profile: buildProfile({ track, artist }) };
  }

  // ---------- 候補探索の計画 ----------
  function planQueries(seeds) {
    const vecs = seeds.map((s) => expandGenres(s.profile.genres));
    const keysOf = (s) =>
      topKeys(s.profile.genres, 0.4, 8).filter((k) => !GENERIC_GENRES.has(k) && GENRES.get(k)?.mbTag);
    const [ka, kb] = seeds.map(keysOf);
    const common = ka.filter((k) => kb.includes(k));
    const mb = (k) => GENRES.get(k).mbTag;
    const queries = [];
    const add = (keys) => {
      const tags = [...new Set(keys.map(mb))];
      if (tags.length && !queries.some((q) => q.join('|') === tags.join('|'))) queries.push(tags);
    };
    if (common.length >= 2) add(common.slice(0, 2));
    if (common.length >= 1) add(common.slice(0, 1));
    const restA = ka.filter((k) => !common.includes(k));
    const restB = kb.filter((k) => !common.includes(k));
    add(restA.slice(0, 1).length ? restA.slice(0, 1) : ka.slice(0, 1));
    add(restB.slice(0, 1).length ? restB.slice(0, 1) : kb.slice(0, 1));

    const countries = seeds.map((s) => s.artist?.country ?? null);
    const country = countries.every((c) => c === 'JP') ? 'JP' : null;
    const years = seeds.map((s) => s.profile.year).filter(Boolean);
    const beginFrom = years.length ? Math.max(1950, Math.min(...years) - 25) : null;
    const beginTo = years.length ? Math.max(...years) : null;

    // 2曲のジャンルベクトルの平均 (候補アーティストの順位付けに使う)
    const merged = {};
    for (const v of vecs) for (const [k, w] of Object.entries(v)) merged[k] = (merged[k] ?? 0) + w / vecs.length;
    return { queries: queries.slice(0, 3), country, beginFrom, beginTo, seedGenreVec: merged };
  }

  function rankArtist(artist, plan) {
    const votes = artist.tags.reduce((s, t) => s + t.count, 0);
    const prominence = Math.min(1, Math.log1p(votes) / Math.log1p(30));
    const affinity = cosine(expandGenres(artistGenreVector(artist)), plan.seedGenreVec) ?? 0;
    return 0.55 * affinity + 0.45 * prominence;
  }

  // ---------- プール(候補集合)の構築 ----------
  async function refillQueue(pool, signal) {
    const round = pool.round;
    pool.round += 1;
    const { plan } = pool;
    const found = [];
    let firstError = null;
    let okCalls = 0;

    for (const tags of plan.queries) {
      try {
        const list = await artists.findArtistsByStyle({
          allTags: tags,
          country: plan.country,
          beginFrom: plan.beginFrom,
          beginTo: plan.beginTo,
          offset: round * 50,
          limit: 50,
          signal,
        });
        okCalls += 1;
        found.push(...list);
      } catch (err) {
        if (err?.code === 'cancelled') throw err;
        firstError ??= err;
      }
    }
    if (okCalls === 0 && plan.queries.length > 0 && firstError) {
      if (pool.candidates.size === 0) throw firstError;
      pool.exhausted = true;
      return;
    }

    if (round === 0) {
      // 参考曲のアーティスト自身も候補元にする(同一アーティストの別曲は件数上限で抑制される)
      for (const s of pool.seeds) if (s.artist) found.push(s.artist);
    }

    const fresh = [];
    for (const a of found) {
      const key = artistKey(a.name);
      if (!key || pool.seenArtists.has(key) || a.type === 'Character') continue;
      pool.seenArtists.add(key);
      fresh.push({ artist: a, rank: rankArtist(a, plan) });
    }
    fresh.sort((x, y) => y.rank - x.rank);
    pool.queue.push(...fresh.map((f) => f.artist));
    if (found.length === 0 || (round > 0 && fresh.length === 0)) pool.exhausted = pool.queue.length === 0;
  }

  function processArtistTracks(pool, artist, tracks) {
    const ak = artistKey(artist.name);
    const seedKeys = pool.seeds.map((s) => `${titleKey(s.track.title)}|${artistKey(s.track.artistName)}`);
    const seedIds = new Set(pool.seeds.map((s) => s.track.trackId));

    const mine = tracks.filter((t) =>
      t.artists.some((n) => {
        const k = artistKey(n);
        return k === ak || (k.length >= 3 && ak.length >= 3 && (k.includes(ak) || ak.includes(k)));
      }),
    );

    // 提供元の返却順を「人気の目安」として保持しながら、同一曲の重複をまとめる
    const groups = new Map();
    for (const t of mine) {
      if (isAlternateVersion(t.versions)) continue;
      const key = titleKey(t.title);
      if (!key) continue;
      const g = groups.get(key);
      if (!g) {
        groups.set(key, { track: { ...t }, dup: 1, order: groups.size });
      } else {
        g.dup += 1;
        if (t.releaseDate && (!g.track.releaseDate || t.releaseDate < g.track.releaseDate)) {
          g.track = { ...t };
        }
      }
    }

    const list = [...groups.values()].sort((a, b) => a.order - b.order).slice(0, TRACKS_PER_ARTIST);
    const votes = artist.tags.reduce((s, t) => s + t.count, 0);
    const artistProm = artist.tags.length ? Math.min(1, Math.log1p(votes) / Math.log1p(30)) : 0.3;

    list.forEach((g, idx) => {
      const t = g.track;
      if (seedIds.has(t.trackId)) return;
      const ck = `${titleKey(t.title)}|${artistKey(t.artistName)}`;
      if (seedKeys.includes(ck) || pool.candidates.has(ck)) return;

      const profile = buildProfile({ track: t, artist });
      const sims = pool.seeds.map((s) => similarity(profile, s.profile));
      const simA = sims[0].score;
      const simB = sims[1].score;
      const rankScore = 1 - idx / Math.max(12, list.length);
      const dupScore = Math.min(g.dup, 5) / 5;
      const pop = 0.75 * (0.6 * rankScore + 0.4 * dupScore) + 0.25 * artistProm;
      const near = Math.max(...sims.map((s) => s.parts.artist ?? 0.5));
      pool.candidates.set(ck, {
        track: t,
        profile,
        artist,
        simA,
        simB,
        parts: sims.map((s) => s.parts),
        base: baseScore(simA, simB) * eraFit(t.releaseYear, pool.seeds.map((s) => s.profile.year)),
        pop,
        near,
        sameArtistAsSeed: pool.seeds.some(
          (s) => s.profile.artistKey === profile.artistKey || (s.artist?.sourceId && s.artist.sourceId === artist.sourceId),
        ),
      });
    });
  }

  async function fill(pool, target, deadline, signal) {
    while (pool.fetchedArtists < target && !pool.exhausted) {
      if (signal?.aborted) throw Errors.cancelled();
      if (Date.now() > deadline) {
        if (pool.candidates.size === 0) throw Errors.timeout();
        break;
      }
      if (pool.queue.length === 0) {
        if (pool.round >= MAX_ROUNDS || pool.plan.queries.length === 0) {
          pool.exhausted = true;
          break;
        }
        await refillQueue(pool, signal);
        continue;
      }
      const n = Math.min(target - pool.fetchedArtists, pool.queue.length, 4);
      const batch = pool.queue.splice(0, n);
      const results = await Promise.allSettled(
        batch.map((a) => catalog.artistTracks(primaryArtistName(a.name), { signal })),
      );
      // 中断された取得結果は一部が欠けているので、取り込まずに破棄する
      if (signal?.aborted) throw Errors.cancelled();
      let firstError = null;
      results.forEach((r, i) => {
        pool.fetchedArtists += 1;
        if (r.status === 'fulfilled') processArtistTracks(pool, batch[i], r.value);
        else firstError ??= r.reason;
      });
      if (firstError && pool.candidates.size === 0 && results.every((r) => r.status === 'rejected')) {
        throw firstError;
      }
    }
  }

  function ensure(pool, target, deadline, signal) {
    const run = pool.chain.then(() => fill(pool, Math.min(target, MAX_ARTISTS), deadline, signal));
    pool.chain = run.catch(() => {});
    return run;
  }

  // ---------- 選定 (スコア調整・多様性・意外性枠) ----------
  const yearPenalty = (c) => (c.track.releaseYear ? 1 : 0.88);

  function coreScore(c, mode) {
    const v =
      mode === 'classic' ? 0.65 * c.base + 0.35 * c.pop
      : mode === 'surprise' ? 0.9 * c.base + 0.1 * (1 - c.near)
      : 0.85 * c.base + 0.15 * c.pop;
    return v * yearPenalty(c);
  }
  const surpriseScore = (c) => (0.7 * c.base + 0.3 * (1 - c.near)) * yearPenalty(c);

  function select(pool, { mode, count, exclude }) {
    const eligible = [...pool.candidates.values()].filter(
      (c) => !exclude.has(c.track.trackId) && c.base >= MIN_BASE && Math.min(c.simA, c.simB) >= MIN_FLOOR,
    );
    const nSurprise = mode === 'surprise' ? Math.ceil(count * 0.6) : mode === 'classic' ? (count > 5 ? 1 : 0) : count > 5 ? 2 : 1;

    const picked = [];
    const perArtist = new Map();
    const chosen = new Set();
    // 入力曲と同じアーティストの曲は、歌い手をすでに知っている前提で全体の件数を絞る
    const seedArtistMax = count > 5 ? 2 : 1;
    let seedArtistPicked = 0;
    const take = (c, cap, surprise) => {
      const ak = c.profile.artistKey;
      if (chosen.has(c) || (perArtist.get(ak) ?? 0) >= cap) return false;
      if (c.sameArtistAsSeed) {
        if (seedArtistPicked >= seedArtistMax) return false;
        seedArtistPicked += 1;
      }
      chosen.add(c);
      perArtist.set(ak, (perArtist.get(ak) ?? 0) + 1);
      picked.push({ c, surprise });
      return true;
    };

    const cap = count > 5 ? 2 : 1;
    const byCore = [...eligible].sort((a, b) => coreScore(b, mode) - coreScore(a, mode));
    const bySurprise = eligible
      .filter((c) => !c.sameArtistAsSeed && c.base >= SURPRISE_MIN_BASE && c.near >= SURPRISE_MIN_NEAR)
      .sort((a, b) => surpriseScore(b) - surpriseScore(a));

    // 1) 共通性の高い本命枠
    for (const c of byCore) {
      if (picked.length >= count - nSurprise) break;
      take(c, cap, false);
    }
    // 2) 意外性枠 (最低類似度は eligible の条件で担保)
    let s = 0;
    for (const c of bySurprise) {
      if (s >= nSurprise || picked.length >= count) break;
      if (take(c, cap, true)) s += 1;
    }
    // 3) 不足分は本命から補う。まだ足りなければ同一アーティスト上限を 1 段階だけ緩める
    for (const c of byCore) if (picked.length < count) take(c, cap, false);
    for (const c of byCore) if (picked.length < count) take(c, cap + 1, false);

    picked.sort((a, b) => coreScore(b.c, mode) - coreScore(a.c, mode));
    return { picked, eligibleCount: eligible.length };
  }

  // ---------- 公開API ----------
  async function recommend({ trackIds, mode, count, excludeTrackIds = [], deadlineMs, signal }) {
    if (signal?.aborted) throw Errors.cancelled();
    const started = Date.now();
    const deadline = started + deadlineMs;
    mode = normalizeMode(mode);
    sweepPools();

    const key = [...trackIds].sort().join('|');
    let pool = pools.get(key);
    const degraded = new Set(pool?.degraded ?? []);

    if (!pool) {
      const tracks = await loadSeeds(trackIds, signal);
      const seeds = [];
      for (const t of tracks) seeds.push(await buildSeed(t, degraded, signal)); // MusicBrainz の間隔制御により直列
      const plan = planQueries(seeds);
      pool = {
        seeds,
        plan,
        queue: [],
        seenArtists: new Set(),
        fetchedArtists: 0,
        candidates: new Map(),
        round: 0,
        exhausted: false,
        chain: Promise.resolve(),
        degraded: [...degraded],
        expiresAt: 0,
      };
      pools.set(key, pool);
    }
    pool.expiresAt = Date.now() + POOL_TTL_MS;

    const exclude = new Set(excludeTrackIds);
    const target = count > 5 ? 12 : 8;
    try {
      await ensure(pool, target, deadline, signal);
      let sel = select(pool, { mode, count, exclude });
      // 候補が足りない場合は探索範囲を広げる(最大 MAX_ARTISTS まで)
      while (sel.picked.length < count && !pool.exhausted && pool.fetchedArtists < MAX_ARTISTS && Date.now() < deadline) {
        await ensure(pool, pool.fetchedArtists + 6, deadline, signal);
        sel = select(pool, { mode, count, exclude });
      }
      return buildResponse(pool, sel, { mode, count, started, degraded, excluded: exclude.size });
    } catch (err) {
      // 失敗したプールは再利用しない(部分的な状態を残さない)。中断された探索も途中の状態なので捨てる。
      if (pool.candidates.size === 0 || err?.code === 'cancelled') pools.delete(key);
      throw err;
    }
  }

  function buildResponse(pool, sel, { mode, count, started, degraded, excluded }) {
    const seeds = pool.seeds;
    const seedSim = similarity(seeds[0].profile, seeds[1].profile);
    const summary = summarizeSeeds(seeds, seedSim);

    const items = sel.picked.map(({ c, surprise }, i) => {
      const badges = [];
      if (surprise) badges.push('意外性枠');
      if (c.sameArtistAsSeed) badges.push('入力曲と同じアーティスト');
      if (mode === 'classic' && c.pop >= 0.6) badges.push('定番寄り（簡易推定）');
      if (!c.track.releaseYear) badges.push('情報不足（発売年不明）');
      const t = c.track;
      return {
        rank: i + 1,
        track: {
          trackId: t.trackId,
          title: t.title,
          artistName: t.artistName,
          album: t.album,
          releaseDate: t.releaseDate,
          releaseYear: t.releaseYear,
        },
        reason: buildReason({ cand: c, seeds, isSurprise: surprise, mode, sameArtistAsSeed: c.sameArtistAsSeed }),
        matchLevel: matchLevelOf(c.base),
        closeness: [closenessOf(c.simA), closenessOf(c.simB)],
        badges,
        karaoke: { status: 'unconfirmed', label: 'カラオケ配信未確認' },
        // 配点調整(仕様書 12章)用。debug のときだけ内部スコアを返す。画面には表示しない。
        ...(debug
          ? { debug: { base: +c.base.toFixed(3), simA: +c.simA.toFixed(3), simB: +c.simB.toFixed(3), pop: +c.pop.toFixed(3), near: +c.near.toFixed(3), parts: c.parts } }
          : {}),
      };
    });

    const notes = [];
    if (mode === 'classic') notes.push('「定番曲優先」の知名度は、提供元の掲載順と収録数からの簡易的な推定です。');
    if (degraded.size) notes.push('一部のアーティスト情報を取得できなかったため、取得できた範囲の情報で推薦しています。');
    const missingSeed = seeds.filter((s) => s.profile.missing.length > 0);
    if (missingSeed.length) notes.push('参考曲に未取得の情報があります。分からない項目は判断材料にしていません。');
    notes.push('曲調・ボーカル構成はタグやジャンルからの推定です。');

    let shortage = null;
    if (items.length < count) {
      const noMore = excluded > 0 && sel.eligibleCount === 0;
      shortage = {
        requested: count,
        returned: items.length,
        message: noMore
          ? 'これ以上、新しい候補は見つかりませんでした。'
          : items.length === 0
            ? '条件に合う候補を見つけられませんでした。'
            : `条件に合う候補が${items.length}曲しか見つかりませんでした。無理に件数を埋めていません。`,
        suggestions: [
          '推薦モードを「意外性重視」に変更する',
          '参考曲をどちらか別の曲に変更する',
          '時間をおいてからもう一度試す',
        ],
      };
    }

    return {
      mode,
      count,
      seeds: seeds.map((s) => ({
        track: s.track,
        profile: describeSeedProfile(s.profile, Boolean(s.artist)),
      })),
      summary,
      items,
      shortage,
      notes,
      meta: {
        elapsedMs: Date.now() - started,
        poolSize: pool.candidates.size,
        artistsChecked: pool.fetchedArtists,
        degraded: [...degraded],
      },
    };
  }

  return { recommend };
}
