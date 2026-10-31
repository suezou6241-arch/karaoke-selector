import { sleep } from './sleep.js';
import { Errors } from '../errors.js';

/**
 * 外部API向けの呼び出し間隔制御。呼び出しは到着順に、最小間隔を空けて開始される。
 * 待ち行列が maxQueue を超えた場合は即座に busy エラーにする。
 * signal が中断済みなら、順番が来ても呼び出しを開始せず、間隔も消費しない。
 */
export class Throttle {
  constructor({ minIntervalMs, maxQueue = 200 }) {
    this.minIntervalMs = minIntervalMs;
    this.maxQueue = maxQueue;
    this.pending = 0;
    this.nextAt = 0;
    this.tail = Promise.resolve();
  }

  /** 提供元からの制限応答を受けたとき、次の開始を遅らせる。 */
  penalize(ms) {
    this.nextAt = Math.max(this.nextAt, Date.now() + ms);
  }

  async run(fn, { signal } = {}) {
    if (signal?.aborted) throw Errors.cancelled();
    if (this.pending >= this.maxQueue) throw Errors.busy();
    this.pending += 1;
    try {
      const prev = this.tail;
      let release;
      this.tail = new Promise((resolve) => {
        release = resolve;
      });
      try {
        await prev;
        if (signal?.aborted) throw Errors.cancelled();
        const wait = this.nextAt - Date.now();
        if (wait > 0) await sleep(wait);
        if (signal?.aborted) throw Errors.cancelled();
        this.nextAt = Math.max(this.nextAt, Date.now()) + this.minIntervalMs;
      } finally {
        release();
      }
      return await fn();
    } finally {
      this.pending -= 1;
    }
  }
}
