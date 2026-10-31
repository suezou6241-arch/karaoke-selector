import { h, mount, trackSub } from '../dom.js';
import { MODES } from '../constants.js';

const sameSong = (a, b) => Boolean(a && b && a.trackId === b.trackId);

/** 進行表示。経過時間の文言は ticker が更新する。 */
export function progressCard({ onCancel, id }) {
  return h(
    'div',
    { class: 'card', role: 'status' },
    h(
      'div',
      { class: 'progress' },
      h('span', { class: 'spinner', 'aria-hidden': 'true' }),
      h('div', {}, h('p', { id, class: 'song-title' }, '準備しています…'), h('p', { class: 'muted small' }, '画面を閉じずにお待ちください。')),
    ),
    onCancel && h('button', { type: 'button', class: 'btn btn-block', onclick: onCancel }, 'キャンセル'),
  );
}

export function errorNotice(error, onRetry) {
  return h(
    'div',
    { class: 'notice notice-error', role: 'alert' },
    h('p', {}, error.message),
    h('p', { class: 'small' }, '選んだ曲と条件はそのまま残っています。'),
    error.retryable && onRetry && h('button', { type: 'button', class: 'btn btn-small', onclick: onRetry }, 'もう一度試す'),
  );
}

export function renderHome(root, ctx) {
  const { state } = ctx;
  const busy = Boolean(state.loading);
  const [s1, s2] = state.seeds;
  const duplicate = sameSong(s1, s2);
  const ready = Boolean(s1 && s2 && !duplicate);

  const slot = (i, track) => {
    const label = `参考曲${i + 1}`;
    return h(
      'div',
      { class: 'card' },
      h('div', { class: 'slot-label' }, label),
      track
        ? [
            h('div', {}, h('div', { class: 'song-title' }, track.title), h('div', { class: 'song-sub' }, trackSub(track))),
            track.versions?.length > 0 && h('div', { class: 'badges' }, track.versions.map((v) => h('span', { class: 'badge badge-warn' }, v))),
            h(
              'div',
              { class: 'btn-row' },
              h('button', { type: 'button', class: 'btn btn-small', disabled: busy, 'aria-label': `${label}を変更`, onclick: () => ctx.openSearch(i) }, '変更'),
              h('button', { type: 'button', class: 'btn btn-small', disabled: busy, 'aria-label': `${label}を解除`, onclick: () => ctx.clearSeed(i) }, '解除'),
            ),
          ]
        : h(
            'div',
            { class: 'slot-empty' },
            h('p', { class: 'muted' }, '歌われた曲を検索して選びます'),
            h('button', { type: 'button', class: 'btn btn-block', disabled: busy, onclick: () => ctx.openSearch(i) }, `🔍 ${label}を検索`),
          ),
    );
  };

  const modeField = h(
    'fieldset',
    { disabled: busy },
    h('legend', {}, '推薦モード'),
    MODES.map((m) =>
      h(
        'label',
        { class: 'choice' },
        h('input', { type: 'radio', name: 'mode', value: m.id, checked: state.mode === m.id, onchange: () => ctx.setMode(m.id) }),
        h('span', { class: 'choice-body' }, h('span', { class: 'choice-name' }, m.name), h('span', { class: 'choice-desc' }, m.desc)),
      ),
    ),
  );

  const countField = h(
    'fieldset',
    { disabled: busy },
    h('legend', {}, '候補数'),
    h(
      'div',
      { class: 'choices-inline' },
      [5, 10].map((n) =>
        h(
          'label',
          { class: 'choice' },
          h('input', { type: 'radio', name: 'count', value: n, checked: state.count === n, onchange: () => ctx.setCount(n) }),
          h('span', { class: 'choice-body' }, h('span', { class: 'choice-name' }, `${n}曲`)),
        ),
      ),
    ),
  );

  const hint = !s1 && !s2 ? '参考曲を2曲選ぶと、おすすめを探せます。' : !s1 || !s2 ? 'あと1曲選ぶと、おすすめを探せます。' : '';

  const recent = ctx.getRecent().filter((t) => !state.seeds.some((s) => s?.trackId === t.trackId));

  mount(
    root,
    h('h2', { id: 'home-heading', class: 'view-heading', tabindex: '-1' }, '参考にする2曲を選ぶ'),
    h('p', { class: 'muted' }, '他の人が歌った2曲から、共通点のある同年代・類似系統の曲をおすすめします。'),
    slot(0, s1),
    slot(1, s2),
    globalThis.navigator?.onLine === false &&
      h(
        'div',
        { class: 'notice notice-warn', role: 'status' },
        h('p', {}, 'オフラインです。曲の検索とおすすめの取得にはインターネット接続が必要です。'),
        h('p', { class: 'small' }, '履歴とお気に入りは、接続なしでも見られます。'),
      ),
    duplicate &&
      h('div', { class: 'notice notice-warn', role: 'alert' }, h('p', {}, '同じ曲が2回選ばれています。どちらかを別の曲に変更してください。')),
    modeField,
    countField,
    state.error && errorNotice(state.error, ctx.startRecommend),
    busy
      ? progressCard({ id: 'progress-text', onCancel: ctx.cancel })
      : h(
          'div',
          {},
          h('button', { type: 'button', class: 'btn btn-primary btn-block', disabled: !ready, onclick: ctx.startRecommend }, 'おすすめ曲を探す'),
          hint && h('p', { class: 'muted small' }, hint),
        ),
    recent.length > 0 &&
      h(
        'section',
        { 'aria-labelledby': 'recent-heading' },
        h('h3', { id: 'recent-heading', class: 'card-title' }, '最近使った曲'),
        h(
          'ul',
          { class: 'recent-list' },
          recent.map((t) =>
            h(
              'li',
              {},
              h(
                'button',
                { type: 'button', class: 'btn btn-block recent-item', disabled: busy, onclick: () => ctx.useRecent(t) },
                h('span', {}, t.title),
                h('span', { class: 'muted small' }, trackSub(t)),
              ),
            ),
          ),
        ),
      ),
  );
}
