import { promises as fs } from "node:fs";
import path from "node:path";
import { validateChallenge, validateChallengeTransition, validChallengeId, type ChallengeRecord } from "./challengeModel.js";

/** One writer, revision checks, immutable history and atomic per-challenge snapshots. */
export class ChallengeStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {}
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation); this.queue = result.catch(() => {}); return result;
  }
  private filename(id: string) {
    if (!validChallengeId(id)) throw new Error("挑战编号无效");
    return path.join(this.directory, `${id}.json`);
  }
  private async read(id: string): Promise<ChallengeRecord> {
    const record: unknown = JSON.parse(await fs.readFile(this.filename(id), "utf8"));
    validateChallenge(record);
    if (record.id !== id) throw new Error("挑战文件编号不符");
    return record;
  }
  get(id: string) { return this.serial(() => this.read(id)); }
  list(): Promise<{ records: ChallengeRecord[]; warnings: string[] }> {
    return this.serial(async () => {
      await fs.mkdir(this.directory, { recursive: true });
      const records: ChallengeRecord[] = [], warnings: string[] = [];
      for (const file of await fs.readdir(this.directory)) {
        if (!file.endsWith(".json") || !validChallengeId(file.slice(0, -5))) continue;
        try { records.push(await this.read(file.slice(0, -5))); }
        catch { warnings.push(`成绩文件 ${file} 无法读取，已保留原文件。`); }
      }
      records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { records, warnings };
    });
  }
  create(value: unknown): Promise<ChallengeRecord> {
    return this.serial(async () => {
      validateChallenge(value); const next = structuredClone(value);
      if (next.revision !== 0 || next.rounds.length || next.status !== "paused" || next.restUntil !== 0) throw new Error("新挑战必须从空记录开始");
      try {
        const previous = await this.read(next.id);
        if (JSON.stringify(previous) === JSON.stringify(next)) return previous;
        throw new Error("挑战编号已存在");
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      await this.write(next); return next;
    });
  }
  save(value: unknown): Promise<ChallengeRecord> {
    return this.serial(async () => {
      validateChallenge(value); const next = structuredClone(value);
      const previous = await this.read(next.id);
      // A lost IPC response may be retried with exactly the same snapshot.
      if (next.revision === previous.revision - 1 && JSON.stringify({ ...next, revision: previous.revision }) === JSON.stringify(previous)) return previous;
      validateChallengeTransition(previous, next);
      if (JSON.stringify(previous) === JSON.stringify(next)) return previous;
      next.revision++; await this.write(next); return next;
    });
  }
  private async write(record: ChallengeRecord) {
    await fs.mkdir(this.directory, { recursive: true });
    const target = this.filename(record.id), temporary = `${target}.tmp`;
    const handle = await fs.open(temporary, "w");
    try { await handle.writeFile(JSON.stringify(record, null, 2), "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    await fs.rename(temporary, target);
  }
}
