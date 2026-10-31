import { Errors } from '../../public/js/core/errors.js';

/** 同時実行数を制限するジョブキュー。待ち行列が満杯なら busy エラー。 */
export class JobQueue {
  constructor({ concurrency, maxQueued }) {
    this.concurrency = concurrency;
    this.maxQueued = maxQueued;
    this.active = 0;
    this.waiters = [];
  }

  async run(fn) {
    if (this.active >= this.concurrency) {
      if (this.waiters.length >= this.maxQueued) throw Errors.busy();
      await new Promise((resolve) => this.waiters.push(resolve));
    } else {
      this.active += 1;
    }
    try {
      return await fn();
    } finally {
      const next = this.waiters.shift();
      if (next) next(); // active 枠を次の待機者へ引き継ぐ
      else this.active -= 1;
    }
  }
}
