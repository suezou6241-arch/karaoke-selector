export const MODES = [
  { id: 'balanced', name: 'バランス重視', desc: '共通性・知名度・意外性をバランスよく選びます' },
  { id: 'classic', name: '定番曲優先', desc: '広く知られた曲を優先します（知名度は簡易的な推定）' },
  { id: 'surprise', name: '意外性重視', desc: '共通性は保ちつつ、少し違う系統の曲も多めに選びます' },
];

export const modeName = (id) => MODES.find((m) => m.id === id)?.name ?? 'バランス重視';

// 内部スコアを精密な数値に見せないため、5段階の目安だけを表示する
export const MATCH_LABELS = ['', '低め', 'やや低め', 'ふつう', '高い', 'とても高い'];

export const LIMITS = { history: 50, favorites: 500, recent: 8 };
