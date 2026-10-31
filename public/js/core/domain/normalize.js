// 楽曲・アーティスト名の正規化と、バージョン(ライブ/リミックス等)の判定。

const BRACKETS = /[(（\[【][^)）\]】]*[)）\]】]/g;

export function textKey(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** 括弧書き(Live/Remix/TV Size 等)を除いた曲名キー。同一曲の重複排除に使う。 */
export function titleKey(title) {
  const base = String(title ?? '')
    .normalize('NFKC')
    .replace(BRACKETS, ' ')
    .replace(/\s[-–]\s.*$/, ' '); // " - Single" や " - Remastered" などの後置き
  return textKey(base);
}

export const artistKey = textKey;

/** 「A & B」「A feat. B」などから主アーティスト名候補を取り出す。 */
export function primaryArtistName(name) {
  const parts = String(name ?? '')
    .split(/\s+(?:&|feat\.?|ft\.?|with|x|×)\s+|\s*[/／、,，]\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts[0] || String(name ?? '').trim();
}

const VERSION_RULES = [
  { id: 'live', label: 'ライブ', re: /live|ライブ|ライヴ|concert|コンサート/i },
  { id: 'remix', label: 'リミックス', re: /remix|リミックス|mix\b(?!ed)/i },
  { id: 'instrumental', label: 'インスト/カラオケ音源', re: /instrumental|インスト|off ?vocal|オフ ?ボーカル|karaoke|カラオケ|backing track/i },
  { id: 'cover', label: 'カバー', re: /cover|カバー|tribute|トリビュート|オルゴール|music ?box|lullaby|α波|セルフカバー/i },
  { id: 'acoustic', label: 'アコースティック', re: /acoustic|アコースティック|unplugged/i },
  { id: 'remaster', label: 'リマスター', re: /remaster|リマスター/i },
  { id: 'edit', label: 'ショート/TV版', re: /tv ?size|tv ?edit|short ?(ver|edit)|ショート|radio ?edit|edit\b/i },
  { id: 'version', label: '別バージョン', re: /\bver\.?|version|バージョン|ヴァージョン/i },
];

/** 曲名の括弧書き・後置き、およびアルバム名・アーティスト名から版情報を推定する。 */
export function detectVersions({ title, album, artistName }) {
  const found = new Map();
  const segments = [];
  for (const m of String(title ?? '').normalize('NFKC').matchAll(BRACKETS)) segments.push(m[0]);
  const trailing = String(title ?? '').normalize('NFKC').match(/\s[-–]\s(.*)$/);
  if (trailing) segments.push(trailing[1]);

  for (const seg of segments) {
    for (const rule of VERSION_RULES) if (rule.re.test(seg)) found.set(rule.id, rule.label);
  }
  // アルバム/アーティスト名は、ライブ盤・カバー盤・カラオケ盤の判定にのみ使う
  const context = `${album ?? ''} ${artistName ?? ''}`.normalize('NFKC');
  for (const id of ['live', 'instrumental', 'cover']) {
    const rule = VERSION_RULES.find((r) => r.id === id);
    if (rule.re.test(context)) found.set(rule.id, rule.label);
  }
  return [...found.entries()].map(([id, label]) => ({ id, label }));
}

/** 推薦候補・主要な参考曲として扱いにくい版(カラオケ音源、カバー等)か。 */
export function isAlternateVersion(versions) {
  return versions.some((v) => ['live', 'remix', 'instrumental', 'cover', 'acoustic', 'edit'].includes(v.id));
}

export function yearOf(dateStr) {
  const m = /^(\d{4})/.exec(dateStr ?? '');
  const y = m ? Number.parseInt(m[1], 10) : null;
  return y && y >= 1900 && y <= 2100 ? y : null;
}

/** iTunes のレコードを内部の楽曲モデルへ変換する。 */
export function trackFromItunes(raw) {
  if (!raw || raw.wrapperType !== 'track' || raw.kind !== 'song' || !raw.trackId) return null;
  const title = String(raw.trackName ?? '').trim();
  const artistName = String(raw.artistName ?? '').trim();
  if (!title || !artistName) return null;
  const releaseDate = typeof raw.releaseDate === 'string' ? raw.releaseDate.slice(0, 10) : null;
  const versions = detectVersions({ title, album: raw.collectionName, artistName });
  return {
    trackId: `itunes:${raw.trackId}`,
    title,
    artists: [artistName],
    artistName,
    album: raw.collectionName ? String(raw.collectionName) : null,
    releaseDate,
    releaseYear: yearOf(releaseDate),
    genre: raw.primaryGenreName ? String(raw.primaryGenreName) : null,
    versions,
    source: 'itunes',
  };
}

/**
 * 同じ曲(曲名キー+アーティスト+版)の重複を 1 件にまとめる。
 * 一番古い発売日のレコードを代表とし、収録数を alsoOn に持たせる。
 */
export function collapseTracks(tracks) {
  const groups = new Map();
  for (const t of tracks) {
    const vkey = t.versions.map((v) => v.id).sort().join('+');
    const key = `${titleKey(t.title)}|${artistKey(t.artistName)}|${vkey}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { ...t, alsoOn: 1, order: groups.size });
      continue;
    }
    g.alsoOn += 1;
    if (t.releaseDate && (!g.releaseDate || t.releaseDate < g.releaseDate)) {
      Object.assign(g, {
        trackId: t.trackId,
        album: t.album,
        releaseDate: t.releaseDate,
        releaseYear: t.releaseYear,
        genre: t.genre ?? g.genre,
      });
    }
  }
  return [...groups.values()].sort((a, b) => a.order - b.order);
}
