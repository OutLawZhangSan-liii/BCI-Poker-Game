import type { ChallengeRecord } from "../../../desktop/main/challengeModel";

/** Failed snapshots stay in memory until retry succeeds; no later mutation can pass them. */
export class ChallengeSession {
  record: ChallengeRecord | null = null;
  pending: ChallengeRecord | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private save: (record: ChallengeRecord) => Promise<ChallengeRecord>;
  private changed: (record: ChallengeRecord) => void;
  private fault: (message: string | null) => void;
  private recover: (record: ChallengeRecord) => ChallengeRecord;
  constructor(save: (record: ChallengeRecord) => Promise<ChallengeRecord>, changed: (record: ChallengeRecord) => void,
    fault: (message: string | null) => void, recover: (record: ChallengeRecord) => ChallengeRecord) {
    this.save = save; this.changed = changed; this.fault = fault; this.recover = recover;
  }
  load(record: ChallengeRecord) { this.record = record; this.pending = null; this.fault(null); this.changed(record); }
  clear() { this.record = null; this.pending = null; this.fault(null); }
  mutate(change: (record: ChallengeRecord) => ChallengeRecord): Promise<ChallengeRecord> {
    const result = this.queue.then(async () => {
      if (this.pending) throw new Error("成绩尚未保存，请先重试保存");
      if (!this.record) throw new Error("没有进行中的挑战");
      const next = change(structuredClone(this.record));
      if (JSON.stringify(next) === JSON.stringify(this.record)) return this.record;
      next.updatedAt = new Date().toISOString();
      return this.persist(next);
    });
    this.queue = result.catch(() => {}); return result;
  }
  private async persist(next: ChallengeRecord) {
    this.pending = next;
    try {
      const record = await this.save(next); this.record = record; this.pending = null; this.fault(null); this.changed(record); return record;
    } catch (error) { this.fault(`成绩保存失败：${(error as Error).message}`); throw error; }
  }
  retry(): Promise<ChallengeRecord | null> {
    const result = this.queue.then(async () => {
      if (!this.pending) return this.record;
      // First preserve the exact failed result, then invalidate any interrupted pending attempt.
      const saved = await this.persist(this.pending);
      if (saved.status === "completed") return saved;
      return this.persist({ ...this.recover(saved), updatedAt: new Date().toISOString() });
    });
    this.queue = result.catch(() => {}); return result;
  }
}
