// innerHTML を使わずに DOM を組み立てる。外部由来の文字列は常に textContent / テキストノード経由で入る。
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

/**
 * 画面のルート要素の中身を置き換える。h() と同じ規則で、配列を展開し、
 * false / null / undefined は描画しない(replaceChildren に直接渡すと "false" という文字が出てしまう)。
 */
export function mount(root, ...children) {
  const nodes = [];
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    nodes.push(child.nodeType ? child : document.createTextNode(String(child)));
  }
  root.replaceChildren(...nodes);
}

export const fmtYear = (year) => (year ? `${year}年` : '発売年不明');

export function fmtDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });
}

export function trackSub(track) {
  return `${track.artistName} · ${fmtYear(track.releaseYear)}`;
}

let statusEl;
export function announce(text) {
  statusEl ??= document.getElementById('status');
  // 同じ文言でも再読み上げされるよう一度空にする
  statusEl.textContent = '';
  setTimeout(() => {
    statusEl.textContent = text;
  }, 50);
}

let toastTimer;
export function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.hidden = false;
  announce(text);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 3200);
}
