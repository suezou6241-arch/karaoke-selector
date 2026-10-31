// 推薦品質の評価ハーネス (仕様書 12章)。実際の iTunes / MusicBrainz に接続する。
//   node scripts/eval.js            全組み合わせを balanced / 10曲で評価
//   node scripts/eval.js 3 4        番号を指定して一部だけ評価
//   EVAL_MODE=surprise node scripts/eval.js
// 外部APIの間隔制御のため、1組あたり数十秒かかる。結果は標準出力に出す。
import { createProviders } from '../server/providers/index.js';
import { createRecommender } from '../public/js/core/domain/recommend.js';
import { collapseTracks, titleKey, artistKey } from '../public/js/core/domain/normalize.js';

// [ラベル, [曲名, 検索語], [曲名, 検索語]]
const PAIRS = [
  ['90年代J-ROCK', ['innocent world', 'innocent world Mr.Children'], ['サウダージ', 'サウダージ ポルノグラフィティ']],
  ['2010年代後半', ['夜に駆ける', '夜に駆ける YOASOBI'], ['Pretender', 'Pretender Official髭男dism']],
  ['90年代女性ソロ', ['Automatic', 'Automatic 宇多田ヒカル'], ['本能', '本能 椎名林檎']],
  ['70年代ニューミュージック', ['やさしさに包まれたなら', 'やさしさに包まれたなら 松任谷由実'], ['時代', '時代 中島みゆき']],
  ['80年代アイドル', ['赤いスイートピー', '赤いスイートピー 松田聖子'], ['DESIRE -情熱-', 'DESIRE 中森明菜']],
  ['演歌', ['津軽海峡・冬景色', '津軽海峡冬景色 石川さゆり'], ['夜桜お七', '夜桜お七 坂本冬美']],
  ['年代・系統が離れた2曲', ['夏色', '夏色 ゆず'], ['ultra soul', 'ultra soul B\'z']],
];

const mode = process.env.EVAL_MODE || 'balanced';
const count = Number(process.env.EVAL_COUNT) || 10;
const only = process.argv.slice(2).map(Number).filter(Boolean);

const providers = createProviders();
const rec = createRecommender({ providers, debug: true });

async function pick([title, query]) {
  const list = collapseTracks(await providers.catalog.searchTracks(query));
  const wantKey = titleKey(title);
  return (
    list.find((t) => titleKey(t.title) === wantKey && t.versions.length === 0) ??
    list.find((t) => titleKey(t.title) === wantKey) ??
    null
  );
}

const fmt = (t) => `${t.title} / ${t.artistName} (${t.releaseYear ?? '年不明'})`;
const summary = [];

for (const [i, [label, a, b]] of PAIRS.entries()) {
  if (only.length && !only.includes(i + 1)) continue;
  console.log(`\n=== ${i + 1}. ${label} [mode=${mode}, count=${count}] ===`);
  const t0 = Date.now();
  try {
    const [ta, tb] = [await pick(a), await pick(b)];
    if (!ta || !tb) {
      console.log(`  参考曲を特定できませんでした: ${!ta ? a[0] : ''} ${!tb ? b[0] : ''}`);
      summary.push({ label, error: 'seed not found' });
      continue;
    }
    console.log(`  A: ${fmt(ta)}\n  B: ${fmt(tb)}`);
    const r = await rec.recommend({ trackIds: [ta.trackId, tb.trackId], mode, count, deadlineMs: 120000 });
    const ms = Date.now() - t0;
    console.log(`  ${ms}ms, artistsChecked=${r.meta.artistsChecked}, pool=${r.meta.poolSize}, degraded=[${r.meta.degraded}]`);
    for (const l of r.summary.lines) console.log(`  共通点: ${l}`);
    for (const it of r.items) {
      const d = it.debug;
      console.log(
        `  ${String(it.rank).padStart(2)}. ${it.track.title} | ${it.track.artistName} | ${it.track.releaseYear ?? '?'} ` +
          `| base=${d.base} A=${d.simA} B=${d.simB} L${it.matchLevel} ${it.badges.length ? `[${it.badges.join(',')}]` : ''}\n      ${it.reason}`,
      );
    }
    if (r.shortage) console.log(`  不足: ${r.shortage.message}`);

    // ---- 自動チェック ----
    const seedIds = new Set([ta.trackId, tb.trackId]);
    const seedKeys = new Set([ta, tb].map((t) => `${titleKey(t.title)}|${artistKey(t.artistName)}`));
    const keys = r.items.map((it) => `${titleKey(it.track.title)}|${artistKey(it.track.artistName)}`);
    const perArtist = {};
    for (const it of r.items) perArtist[artistKey(it.track.artistName)] = (perArtist[artistKey(it.track.artistName)] ?? 0) + 1;
    const seedYears = [ta, tb].map((t) => t.releaseYear).filter(Boolean);
    const lo = Math.min(...seedYears);
    const hi = Math.max(...seedYears);
    const far = r.items.filter((it) => it.track.releaseYear && (it.track.releaseYear < lo - 15 || it.track.releaseYear > hi + 15));

    // 実在性: 返却した trackId を提供元で再取得し、曲名・アーティストが一致することを確認する
    const looked = await providers.catalog.lookupTracks(r.items.map((it) => it.track.trackId));
    const lookedMap = new Map(looked.map((t) => [t.trackId, t]));
    const missing = r.items.filter((it) => {
      const t = lookedMap.get(it.track.trackId);
      return !t || t.title !== it.track.title || t.artistName !== it.track.artistName;
    });

    const badReason = r.items.filter((it) => !it.track.releaseYear && /\d{4}年/.test(it.reason));
    const checks = {
      'exist (lookup matches)': missing.length === 0,
      'no seed included': r.items.every((it) => !seedIds.has(it.track.trackId)) && keys.every((k) => !seedKeys.has(k)),
      'no duplicates': new Set(keys).size === keys.length,
      'max 2 per artist': Math.max(0, ...Object.values(perArtist)) <= 2,
      'years within seed range +-15': far.length === 0,
      'no year claim when year unknown': badReason.length === 0,
      'every item has a reason': r.items.every((it) => it.reason && it.reason.length > 10),
    };
    for (const [k, ok] of Object.entries(checks)) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${k}`);
    if (missing.length) console.log('  missing:', missing.map((m) => m.track.title));
    if (far.length) console.log('  far-from-seed years:', far.map((f) => `${f.track.title}(${f.track.releaseYear})`));
    summary.push({ label, n: r.items.length, ms, fails: Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k) });
  } catch (err) {
    console.log(`  ERROR ${err.code ?? ''} ${err.userMessage ?? err.message}`);
    summary.push({ label, error: err.code ?? err.message });
  }
}

console.log('\n=== まとめ ===');
for (const s of summary) {
  console.log(s.error ? `  ${s.label}: ERROR ${s.error}` : `  ${s.label}: ${s.n}曲 ${(s.ms / 1000).toFixed(0)}s ${s.fails.length ? `FAIL(${s.fails.join(', ')})` : 'ok'}`);
}
process.exit(summary.some((s) => s.error || s.fails?.length) ? 1 : 0);
