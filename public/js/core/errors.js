// 利用者に見せるメッセージ(userMessage)と内部ログ用のメッセージを分けて保持する。
export class AppError extends Error {
  constructor(code, status, userMessage, { retryable = false, cause } = {}) {
    super(`${code}: ${userMessage}`);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.userMessage = userMessage;
    this.retryable = retryable;
    if (cause) this.cause = cause;
  }
}

export const Errors = {
  badRequest: (msg) => new AppError('bad_request', 400, msg),
  notFound: (msg) => new AppError('not_found', 404, msg),
  tooManyRequests: (sec) =>
    new AppError('rate_limited', 429, `リクエストが多すぎます。${sec}秒ほど待ってからお試しください。`, {
      retryable: true,
    }),
  // 利用者または呼び出し側が処理を中断した。失敗ではないので再試行の案内は不要。
  cancelled: () => new AppError('cancelled', 499, '中断しました。'),
  busy: () =>
    new AppError('busy', 503, 'ただいま混み合っています。少し待ってからもう一度お試しください。', {
      retryable: true,
    }),
  timeout: (cause) =>
    new AppError(
      'upstream_timeout',
      504,
      '楽曲データの取得に時間がかかっています。時間をおいて、もう一度お試しください。',
      { retryable: true, cause },
    ),
  upstreamLimited: (cause) =>
    new AppError(
      'upstream_rate_limited',
      503,
      '楽曲データ提供元の利用制限に達しました。しばらく待ってから再試行してください。',
      { retryable: true, cause },
    ),
  upstream: (cause) =>
    new AppError(
      'upstream_error',
      502,
      '楽曲データ提供元でエラーが発生しました。時間をおいて再試行してください。',
      { retryable: true, cause },
    ),
  network: (cause) =>
    new AppError(
      'network_error',
      502,
      '楽曲データ提供元に接続できませんでした。通信状況を確認して再試行してください。',
      { retryable: true, cause },
    ),
  internal: (cause) =>
    new AppError('internal', 500, '予期しないエラーが発生しました。もう一度お試しください。', {
      retryable: true,
      cause,
    }),
};
