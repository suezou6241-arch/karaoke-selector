import { expandGenres } from './profile.js';

// 仕様書 5.1 の初期配点 (仮設定。評価結果に基づいて調整する)
export const WEIGHTS = Object.freeze({ era: 25, genre: 25, mood: 25, vocalInstr: 15, artist: 10 });

const ERA_SIGMA = 8; // 年差の許容幅。5年差で約0.82、10年差で約0.46、20年差で約0.04

export function cosine(a, b) {
  const ka = Object.keys(a ?? {});
  const kb = Object.keys(b ?? {});
  if (ka.length === 0 || kb.length === 0) return null;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const k of ka) {
    na += a[k] ** 2;
    if (b[k] !== undefined) dot += a[k] * b[k];
  }
  for (const k of kb) nb += b[k] ** 2;
  return na === 0 || nb === 0 ? null : dot / Math.sqrt(na * nb);
}

function eraSim(a, b) {
  if (!a.year || !b.year) return null;
  const d = Math.abs(a.year - b.year);
  return Math.exp(-(d ** 2) / (2 * ERA_SIGMA ** 2));
}

function vocalSim(a, b) {
  if (!a.vocal || !b.vocal) return null;
  const x = a.vocal.type;
  const y = b.vocal.type;
  if (x === y) return 1;
  const solos = ['male_solo', 'female_solo', 'solo'];
  if (solos.includes(x) && solos.includes(y)) {
    return x === 'solo' || y === 'solo' ? 0.6 : 0.15; // 男女ソロの不一致は低く、性別不明は中間
  }
  return 0.4; // グループとソロ。グループ内の声質は不明なので中間やや低め
}

function vocalInstrSim(a, b) {
  const parts = [];
  const v = vocalSim(a, b);
  if (v !== null) parts.push(v);
  const i = cosine(a.instr, b.instr);
  if (i !== null) parts.push(i);
  return parts.length ? parts.reduce((s, x) => s + x, 0) / parts.length : null;
}

function artistSim(a, b) {
  if (a.artistKey && a.artistKey === b.artistKey) return 1;
  const c = cosine(a.rawTags, b.rawTags);
  return c === null ? null : c * 0.85;
}

/**
 * 2つのプロファイルの類似度 (0〜1)。
 * 欠損カテゴリは配点から除いて正規化し、利用できた配点が少ないほど控えめに評価する。
 */
export function similarity(a, b) {
  const parts = {
    era: eraSim(a, b),
    genre: cosine(expandGenres(a.genres), expandGenres(b.genres)),
    mood: cosine(a.moods, b.moods),
    vocalInstr: vocalInstrSim(a, b),
    artist: artistSim(a, b),
  };
  let sum = 0;
  let avail = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) {
    if (parts[k] === null) continue;
    sum += w * parts[k];
    avail += w;
  }
  if (avail === 0) return { score: 0, parts, coverage: 0 };
  const coverage = avail / 100;
  return { score: (sum / avail) * (0.6 + 0.4 * coverage), parts, coverage };
}

/** 仕様書 5.2: 双方への類似性。低い方を重視した基礎スコア。 */
export function baseScore(simA, simB) {
  return 0.6 * Math.min(simA, simB) + 0.4 * ((simA + simB) / 2);
}
