import { h, trackSub, announce } from './dom.js';
import { searchTracks, ApiError } from './api.js';

/**
 * 楽曲検索ダイアログ (FR-01 / 6.2)。
 * 状態: 初期 / 検索中 / 結果あり / 結果なし / エラー を明示的に表示する。
 */
export function createSearchDialog(dialog, { onPick }) {
  let slotLabel = '';
  let controller = null;
  let state = { kind: 'idle' };
  let input;
  let body;
  let lastQuery = '';

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close(); // 背景タップで閉じる
  });
  dialog.addEventListener('close', () => {
    controller?.abort();
    dialog.replaceChildren();
  });

  function renderBody() {
    const nodes = [];
    switch (state.kind) {
      case 'idle':
        nodes.push(
          h('p', { class: 'muted' }, '曲名、アーティスト名、またはその両方で検索できます。'),
          h('p', { class: 'muted small' }, '例: 「アゲハ蝶 ポルノグラフィティ」'),
        );
        break;
      case 'loading':
        nodes.push(
          h('div', { class: 'progress', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', {}, '検索しています…')),
        );
        break;
      case 'empty':
        nodes.push(
          h(
            'div',
            { class: 'notice' },
            h('p', {}, `「${state.query}」に一致する曲が見つかりませんでした。`),
            h('p', { class: 'small' }, '曲名の一部だけにする、アーティスト名を足す、ひらがな・カタカナ・英字の表記を変えるなど、検索語を変えてお試しください。'),
          ),
        );
        break;
      case 'error':
        nodes.push(
          h(
            'div',
            { class: 'notice notice-error', role: 'alert' },
            h('p', {}, state.message),
            state.retryable && h('button', { type: 'button', class: 'btn btn-small', onclick: () => runSearch(state.query) }, 'もう一度検索'),
          ),
        );
        break;
      case 'results':
        nodes.push(
          h('p', { class: 'muted small' }, `${state.results.length}件（アーティスト名・発売年・版を見て選んでください）`),
          h(
            'ul',
            { class: 'result-list' },
            state.results.map((t) => resultItem(t)),
          ),
          h('p', { class: 'muted small' }, '検索結果の提供元: iTunes Search API'),
        );
        break;
    }
    body.replaceChildren(...nodes);
    body.scrollTop = 0;
  }

  function resultItem(t) {
    const meta = [t.releaseYear ? `${t.releaseYear}年` : '発売年不明', t.album].filter(Boolean).join(' · ');
    return h(
      'li',
      { class: 'card search-item' },
      h(
        'div',
        { class: 'info' },
        h('div', { class: 'song-title' }, t.title),
        h('div', { class: 'song-sub' }, t.artistName),
        h('div', { class: 'song-sub small' }, meta),
        (t.versions.length > 0 || t.alsoOn > 1) &&
          h(
            'div',
            { class: 'badges' },
            t.versions.map((v) => h('span', { class: 'badge badge-warn' }, v)),
            t.alsoOn > 1 && h('span', { class: 'badge' }, `${t.alsoOn}件の収録盤`),
          ),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-primary btn-small',
          'aria-label': `${slotLabel}に「${t.title}」（${trackSub(t)}）を選択`,
          onclick: () => {
            onPick(t);
            dialog.close();
          },
        },
        '選択',
      ),
    );
  }

  async function runSearch(query) {
    controller?.abort();
    controller = new AbortController();
    const mine = controller;
    lastQuery = query;
    state = { kind: 'loading', query };
    renderBody();
    try {
      const data = await searchTracks(query, mine.signal);
      if (mine.signal.aborted) return;
      state = data.results.length
        ? { kind: 'results', query, results: data.results }
        : { kind: 'empty', query };
      announce(data.results.length ? `${data.results.length}件の検索結果があります` : '検索結果がありません');
    } catch (err) {
      if (mine.signal.aborted || err.code === 'cancelled') return;
      state = {
        kind: 'error',
        query,
        message: err instanceof ApiError ? err.message : '検索中にエラーが発生しました。',
        retryable: err instanceof ApiError ? err.retryable : true,
      };
    }
    renderBody();
  }

  function open(label) {
    slotLabel = label;
    state = { kind: 'idle' };
    input = h('input', {
      type: 'search',
      id: 'search-input',
      name: 'q',
      maxlength: '100',
      autocomplete: 'off',
      autocapitalize: 'off',
      enterkeyhint: 'search',
      placeholder: '曲名・アーティスト名',
      'aria-label': '曲名またはアーティスト名',
      value: lastQuery,
    });
    body = h('div', { class: 'sheet-body' });
    const form = h(
      'form',
      {
        class: 'search-form',
        role: 'search',
        onsubmit: (e) => {
          e.preventDefault();
          const q = input.value.trim();
          if (q) runSearch(q);
          else {
            state = { kind: 'idle' };
            renderBody();
            input.focus();
          }
        },
      },
      input,
      h('button', { type: 'submit', class: 'btn btn-primary' }, '検索'),
    );
    dialog.replaceChildren(
      h(
        'div',
        { class: 'sheet-inner' },
        h(
          'div',
          { class: 'sheet-head' },
          h(
            'div',
            { class: 'sheet-top' },
            h('h2', { id: 'search-title' }, `${label}を検索`),
            h('button', { type: 'button', class: 'btn btn-small', onclick: () => dialog.close() }, '閉じる'),
          ),
          form,
        ),
        body,
      ),
    );
    renderBody();
    dialog.showModal();
    input.focus();
  }

  return { open };
}
