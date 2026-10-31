import { eraLabel } from './taxonomy.js';
import { genreLabel, moodLabel, sharedKeys, topKeys } from './profile.js';

const q = (s) => `「${s}」`;

/**
 * 推薦理由は、取得済みのメタデータと計算結果だけから組み立てる(AI 不使用)。
 * 未取得の項目には触れない。曲調・ボーカルなど推定値は「推定」「傾向」と明記する。
 */
export function buildReason({ cand, seeds, isSurprise, mode, sameArtistAsSeed }) {
  const [sa, sb] = seeds;
  const y = cand.track.releaseYear;
  const ys = [sa.profile.year, sb.profile.year];
  const parts = [];

  // --- 1文目: 年代 + ジャンル ---
  let lead;
  const knownSeedYears = ys.filter(Boolean);
  if (!y) {
    lead = '発売年は未確認ですが、';
  } else if (knownSeedYears.length === 0) {
    lead = `${y}年の楽曲で、`;
  } else {
    const diffs = ys.map((v) => (v ? Math.abs(y - v) : null));
    const known = diffs.filter((d) => d !== null);
    const dmax = Math.max(...known);
    const dmin = Math.min(...known);
    if (known.length === 2 && dmax <= 5) {
      lead = `2曲と近い時期（${y}年）の楽曲で、`;
    } else if (dmin <= 5) {
      const near = diffs[0] !== null && diffs[0] <= 5 ? sa : sb;
      lead = `「${near.track.title}」と近い時期（${y}年）の楽曲で、`;
    } else {
      lead = `年代は少し離れています（${y}年）が、`;
    }
  }

  const gC = cand.profile.genres;
  const sharedBoth = sharedKeys([gC, sa.profile.genres, sb.profile.genres], 0.5);
  let genrePhrase;
  if (sharedBoth.length) {
    genrePhrase = `${sharedBoth.slice(0, 2).map((k) => q(genreLabel(k))).join('')}のジャンルが2曲と共通しています。`;
  } else {
    const sharedA = sharedKeys([gC, sa.profile.genres], 0.5);
    const sharedB = sharedKeys([gC, sb.profile.genres], 0.5);
    if (sharedA.length || sharedB.length) {
      const useA = sharedA.length >= sharedB.length;
      const label = (useA ? sharedA : sharedB).slice(0, 2).map((k) => q(genreLabel(k))).join('');
      genrePhrase = `${label}のジャンルが「${(useA ? sa : sb).track.title}」と共通しています。`;
    } else {
      genrePhrase = null;
    }
  }
  parts.push(genrePhrase ? `${lead}${genrePhrase}` : `${lead.replace(/、$/, '')}です。`);

  // --- 2文目: 補足を1つだけ ---
  const moodShared = sharedKeys([cand.profile.moods, sa.profile.moods, sb.profile.moods], 0.35);
  const vocalSame =
    cand.profile.vocal && cand.profile.vocal.type === sa.profile.vocal?.type && sa.profile.vocal?.type === sb.profile.vocal?.type
      ? cand.profile.vocal.label
      : null;

  if (sameArtistAsSeed) {
    parts.push('入力曲と同じアーティストの別の曲です。');
  } else if (isSurprise) {
    parts.push('入力曲とは少し違う系統のアーティストから、意外性のある候補として選びました。');
  } else if (moodShared.length) {
    parts.push(
      `曲調は${moodShared.slice(0, 2).map((k) => q(moodLabel(k))).join('')}の傾向が近いと推定されます（タグ・ジャンルからの推定）。`,
    );
  } else if (vocalSame) {
    parts.push(`ボーカル構成（${vocalSame}）も共通しています（推定）。`);
  } else if (mode === 'classic' && cand.pop >= 0.6) {
    parts.push('広く知られている可能性が高い曲です（提供元の掲載順などからの簡易推定）。');
  }
  return parts.join('');
}

/** 2曲の共通点の要約 (FR-04)。 */
export function summarizeSeeds(seeds, seedSim) {
  const [a, b] = seeds;
  const lines = [];

  if (a.profile.year && b.profile.year) {
    const d = Math.abs(a.profile.year - b.profile.year);
    const mid = Math.round((a.profile.year + b.profile.year) / 2);
    if (d <= 5) lines.push(`発売年は${a.profile.year}年と${b.profile.year}年で、どちらも${eraLabel(mid)}の楽曲です。`);
    else if (d <= 10) lines.push(`発売年は${a.profile.year}年と${b.profile.year}年で、近い時期の楽曲です。`);
    else lines.push(`発売年は${a.profile.year}年と${b.profile.year}年で、年代が離れています。`);
  } else {
    lines.push('発売年が不明な曲があるため、年代の共通点は判断できません。');
  }

  const sharedGenres = sharedKeys([a.profile.genres, b.profile.genres], 0.5);
  if (sharedGenres.length) lines.push(`共通するジャンル: ${sharedGenres.slice(0, 3).map(genreLabel).join('、')}`);
  else if (Object.keys(a.profile.genres).length && Object.keys(b.profile.genres).length)
    lines.push('ジャンルの共通点は見つかりませんでした。');
  else lines.push('ジャンル情報が不足している曲があります。');

  const sharedMoods = sharedKeys([a.profile.moods, b.profile.moods], 0.35);
  if (sharedMoods.length) lines.push(`曲調の傾向（推定）: ${sharedMoods.slice(0, 3).map(moodLabel).join('、')}`);

  if (a.profile.vocal && b.profile.vocal && a.profile.vocal.type === b.profile.vocal.type)
    lines.push(`ボーカル構成（推定）: どちらも${a.profile.vocal.label}`);

  let strength = 3;
  if (seedSim.score < 0.55) strength = 2;
  if (seedSim.score < 0.35) strength = 1;
  if (strength === 1) lines.push('2曲の共通点が少ないため、片方に近い曲や意外性のある曲も含めて探します。');

  return { lines, strength, label: ['', '共通点は少なめ', '共通点はふつう', '共通点は多め'][strength] };
}

export function describeSeedProfile(profile, artistMatched) {
  return {
    year: profile.year,
    genres: topKeys(profile.genres, 0.5, 3).map(genreLabel),
    moods: topKeys(profile.moods, 0.35, 3).map(moodLabel),
    vocal: profile.vocal?.label ?? null,
    moodInferred: profile.flags.moodInferred,
    artistMatched,
    missing: profile.missing,
  };
}
