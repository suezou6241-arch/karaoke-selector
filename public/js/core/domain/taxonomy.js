// ジャンル・曲調・編成の分類表。提供元ごとに異なる表記を内部の共通キーへ寄せる。
// 曲調・編成はタグ名やジャンルからの「推定」であり、プロファイル側で推定フラグを付ける。

/** key, 表示名, 親ジャンル, 別名(小文字), MusicBrainz検索で使う代表タグ */
const GENRE_TABLE = [
  ['pop', 'ポップス', [], ['pop', 'ポップス', 'ポップ', 'pop music', 'ポップ/ロック'], 'pop'],
  ['jpop', 'J-POP', ['pop'], ['j-pop', 'jpop', 'j pop', 'japanese pop', 'jポップ'], 'j-pop'],
  ['kayokyoku', '歌謡曲', ['pop'], ['kayokyoku', 'kayōkyoku', 'kayou kyoku', 'ka-yo-kyoku', '歌謡曲', '歌謡', 'showa kayo'], 'kayōkyoku'],
  ['citypop', 'シティポップ', ['pop'], ['city pop', 'citypop', 'シティポップ'], 'city pop'],
  ['newmusic', 'ニューミュージック', ['pop', 'folk'], ['new music', 'ニューミュージック'], 'new music'],
  ['enka', '演歌', [], ['enka', '演歌', 'enka/kayoukyoku'], 'enka'],
  ['rock', 'ロック', [], ['rock', 'ロック', 'rock music', 'classic rock'], 'rock'],
  ['jrock', 'J-ROCK', ['rock'], ['j-rock', 'jrock', 'j rock', 'japanese rock', '邦ロック'], 'j-rock'],
  ['altrock', 'オルタナ/インディーロック', ['rock'], ['alternative rock', 'alternative-rock', 'alt rock', 'indie rock', 'indie', 'オルタナティブ', 'オルタナティブ・ロック', 'オルタナティヴ'], 'alternative rock'],
  ['poprock', 'ポップロック', ['rock', 'pop'], ['pop rock', 'pop-rock', 'power pop', 'ポップロック'], 'pop rock'],
  ['hardrock', 'ハードロック/メタル', ['rock'], ['hard rock', 'heavy metal', 'metal', 'ハードロック', 'ヘヴィメタル', 'メタル', 'ヘビーメタル'], 'hard rock'],
  ['punk', 'パンク', ['rock'], ['punk', 'punk rock', 'pop punk', 'melodic hardcore', 'パンク', 'emo', 'パンク・ロック'], 'punk rock'],
  ['visual', 'ヴィジュアル系', ['jrock'], ['visual kei', 'visual-kei', 'ヴィジュアル系', 'ビジュアル系', 'visual'], 'visual kei'],
  ['folk', 'フォーク', [], ['folk', 'フォーク', 'folk rock', 'フォーク/ロック'], 'folk'],
  ['singer', 'シンガーソングライター', ['pop'], ['singer-songwriter', 'singer songwriter', 'シンガーソングライター', 'singer/songwriter'], 'singer-songwriter'],
  ['idol', 'アイドル', ['pop'], ['idol', 'idols', 'アイドル', 'j-idol', 'idol pop', 'japanese idol'], 'idol'],
  ['anime', 'アニメ/アニソン', [], ['anime', 'アニメ', 'anison', 'anime song', 'アニソン', 'anime & manga', 'animation'], 'anime'],
  ['game', 'ゲーム音楽', [], ['video game music', 'game', 'ゲーム', 'vgm'], 'video game music'],
  ['vocaloid', 'ボーカロイド', ['electronic'], ['vocaloid', 'ボーカロイド', 'vocaloid pop', 'utaite'], 'vocaloid'],
  ['hiphop', 'ヒップホップ/ラップ', [], ['hip hop', 'hip-hop', 'hiphop', 'rap', 'ヒップホップ', 'ヒップホップ/ラップ', 'j-rap', 'japanese hip hop'], 'hip hop'],
  ['rnb', 'R&B/ソウル', [], ['r&b', 'rnb', 'r&b/soul', 'rhythm and blues', 'contemporary r&b', 'soul', 'ソウル', 'funk', 'ファンク', 'neo soul'], 'r&b'],
  ['electronic', 'エレクトロニック', [], ['electronic', 'electronica', 'edm', 'techno', 'house', 'electropop', 'synth-pop', 'synthpop', 'synth pop', 'エレクトロニック', 'エレクトロニカ', 'dance-pop'], 'electronic'],
  ['dance', 'ダンス', ['electronic'], ['dance', 'dance pop', 'eurobeat', 'ダンス', 'disco', 'ディスコ'], 'dance'],
  ['jazz', 'ジャズ', [], ['jazz', 'ジャズ', 'jazz fusion', 'smooth jazz', 'fusion', 'フュージョン'], 'jazz'],
  ['ballad', 'バラード', ['pop'], ['ballad', 'ballads', 'バラード', 'power ballad'], 'ballad'],
  ['reggae', 'レゲエ/スカ', [], ['reggae', 'ska', 'レゲエ', 'スカ'], 'reggae'],
  ['blues', 'ブルース', [], ['blues', 'ブルース'], 'blues'],
  ['kpop', 'K-POP', ['pop'], ['k-pop', 'kpop', 'ケイポップ'], 'k-pop'],
  ['latin', 'ラテン', [], ['latin', 'ラテン', 'bossa nova', 'ボサノバ'], 'latin'],
  ['children', '童謡/キッズ', [], ['children', "children's music", 'キッズ', '童謡', 'ディズニー'], "children's music"],
];

export const GENRES = new Map(
  GENRE_TABLE.map(([key, label, parents, aliases, mbTag]) => [key, { key, label, parents, aliases, mbTag }]),
);

const ALIAS_TO_GENRE = new Map();
for (const g of GENRES.values()) {
  for (const alias of g.aliases) ALIAS_TO_GENRE.set(alias.toLowerCase(), g.key);
  ALIAS_TO_GENRE.set(g.key, g.key);
}

/** 提供元のジャンル/タグ文字列を内部ジャンルキーに変換。未知の語は null。 */
export function genreKeyFromTag(raw) {
  const s = String(raw ?? '').normalize('NFKC').trim().toLowerCase();
  if (!s) return null;
  if (ALIAS_TO_GENRE.has(s)) return ALIAS_TO_GENRE.get(s);
  // 「rock_classic rock」「rock/goth rock」のような派生タグは、完全一致しない場合は採用しない
  return null;
}

/** 曲調タグ。明示タグからの対応表。 */
export const MOODS = new Map([
  ['sad', { label: '切ない', aliases: ['sad', 'melancholic', 'melancholy', 'emotional', 'tearjerker', 'bittersweet', 'heartbreak'] }],
  ['bright', { label: '明るい', aliases: ['happy', 'upbeat', 'cheerful', 'fun', 'feel good', 'feel-good', 'sunny', 'uplifting'] }],
  ['intense', { label: '激しい', aliases: ['aggressive', 'intense', 'heavy', 'energetic', 'loud'] }],
  ['calm', { label: '落ち着いた', aliases: ['calm', 'mellow', 'chill', 'relaxing', 'laid-back', 'soft', 'gentle', 'peaceful'] }],
  ['powerful', { label: '力強い', aliases: ['powerful', 'anthemic', 'epic', 'passionate'] }],
  ['groovy', { label: 'ノリが良い', aliases: ['danceable', 'groovy', 'party', 'rhythmic', 'catchy'] }],
  ['nostalgic', { label: '懐かしい', aliases: ['nostalgic', 'retro', 'nostalgia'] }],
  ['dark', { label: 'ダーク', aliases: ['dark', 'gothic', 'dramatic', 'brooding'] }],
]);

const ALIAS_TO_MOOD = new Map();
for (const [key, m] of MOODS) for (const a of m.aliases) ALIAS_TO_MOOD.set(a, key);

export function moodKeyFromTag(raw) {
  return ALIAS_TO_MOOD.get(String(raw ?? '').trim().toLowerCase()) ?? null;
}

/** ジャンルから推測される曲調の傾向。これは「推定」であり、事実として表示しない。 */
export const GENRE_MOOD_PRIOR = {
  ballad: { sad: 0.8, calm: 0.6 },
  enka: { sad: 0.8, powerful: 0.4 },
  kayokyoku: { sad: 0.5, nostalgic: 0.6 },
  citypop: { groovy: 0.6, calm: 0.5, nostalgic: 0.4 },
  rock: { powerful: 0.6 },
  jrock: { powerful: 0.6 },
  altrock: { powerful: 0.4 },
  poprock: { bright: 0.5, powerful: 0.4 },
  hardrock: { intense: 0.8, powerful: 0.6 },
  punk: { intense: 0.8, bright: 0.4 },
  visual: { dark: 0.6, intense: 0.5 },
  idol: { bright: 0.8 },
  anime: { bright: 0.4, powerful: 0.4 },
  vocaloid: { groovy: 0.4, intense: 0.3 },
  folk: { calm: 0.7, nostalgic: 0.5 },
  newmusic: { calm: 0.5, nostalgic: 0.6 },
  hiphop: { groovy: 0.7 },
  rnb: { groovy: 0.6, calm: 0.4 },
  electronic: { groovy: 0.7, bright: 0.3 },
  dance: { groovy: 0.8, bright: 0.4 },
  jazz: { calm: 0.6 },
  jpop: { bright: 0.3 },
  reggae: { calm: 0.5, groovy: 0.5 },
};

/** 音楽性・編成 */
export const INSTRUMENTATION = new Map([
  ['band', { label: 'バンドサウンド', aliases: ['band', 'guitar', 'バンド'] }],
  ['synth', { label: 'シンセ・打ち込み', aliases: ['synth', 'synthesizer', 'programming', 'electronic production'] }],
  ['acoustic', { label: 'アコースティック', aliases: ['acoustic', 'piano', 'acoustic guitar', 'アコースティック'] }],
  ['jazzens', { label: 'ジャズ編成', aliases: ['big band', 'jazz band'] }],
  ['wafu', { label: '和風編成', aliases: ['traditional japanese', 'shamisen', '和風'] }],
]);

const ALIAS_TO_INSTR = new Map();
for (const [key, m] of INSTRUMENTATION) for (const a of m.aliases) ALIAS_TO_INSTR.set(a, key);

export function instrKeyFromTag(raw) {
  return ALIAS_TO_INSTR.get(String(raw ?? '').trim().toLowerCase()) ?? null;
}

export const GENRE_INSTR_PRIOR = {
  rock: { band: 0.8 },
  jrock: { band: 0.8 },
  altrock: { band: 0.8 },
  poprock: { band: 0.8 },
  hardrock: { band: 0.9 },
  punk: { band: 0.9 },
  visual: { band: 0.8 },
  folk: { acoustic: 0.8 },
  newmusic: { acoustic: 0.5, band: 0.4 },
  singer: { acoustic: 0.5 },
  ballad: { acoustic: 0.5 },
  electronic: { synth: 0.8 },
  dance: { synth: 0.8 },
  vocaloid: { synth: 0.9 },
  idol: { synth: 0.5 },
  hiphop: { synth: 0.5 },
  rnb: { synth: 0.4 },
  jazz: { jazzens: 0.8 },
  enka: { wafu: 0.6 },
  kayokyoku: { wafu: 0.2 },
};

/** ボーカル構成の表示名 */
export const VOCAL_LABELS = {
  male_solo: '男性ソロ',
  female_solo: '女性ソロ',
  group: 'グループ',
  solo: 'ソロ',
};

/** 時代の呼び方 (例: 1990年代後半)。 */
export function eraLabel(year) {
  if (!year) return null;
  const decade = Math.floor(year / 10) * 10;
  const part = year % 10;
  const half = part <= 3 ? '前半' : part >= 7 ? '後半' : '中盤';
  return `${decade}年代${half}`;
}
