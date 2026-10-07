import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { OutlineDocSchema, type OutlineDoc } from './outline.types';
import { OutlineCorruptError } from './outline.error';
import { resolveOutlinePath, seedOutline } from '../common/utils';

// Single-writer file store. Array order in the JSON file is the outline order.
@Injectable()
export class OutlineStore {
  private readonly logger = new Logger(OutlineStore.name);
  private readonly filePath: string;
  private chain: Promise<unknown> = Promise.resolve();

  constructor() {
    this.filePath = resolveOutlinePath();
    this.logger.log(`outline file: ${this.filePath}`);
  }

  getPath(): string {
    return this.filePath;
  }

  async load(): Promise<OutlineDoc> {
    return this.enqueue(() => this.readOrSeed());
  }

  async save(doc: OutlineDoc): Promise<OutlineDoc> {
    const parsed = OutlineDocSchema.parse(doc);
    return this.enqueue(async () => {
      await this.writeAtomic(parsed);
      return parsed;
    });
  }

  async update(mutator: (doc: OutlineDoc) => OutlineDoc | Promise<OutlineDoc>): Promise<OutlineDoc> {
    return this.enqueue(async () => {
      const current = await this.readOrSeed();
      // Deep copy so mutators cannot retain internal refs.
      const draft: OutlineDoc = { items: current.items.map((i) => ({ ...i })) };
      const next = await mutator(draft);
      const parsed = OutlineDocSchema.parse(next);
      await this.writeAtomic(parsed);
      return parsed;
    });
  }

  // Serializes all file access: concurrent tool calls in one agent turn
  // must not interleave load→save cycles.
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn) as Promise<T>;
    // Keep the chain alive even if this task rejects for its own caller.
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async readOrSeed(): Promise<OutlineDoc> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (err: unknown) {
      // Missing file on clean checkout: create from seed so `npm run dev` just works.
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        const seed = seedOutline();
        await this.writeAtomic(seed);
        this.logger.log('outline file missing — created from seed');
        return seed;
      }
      throw err;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      throw new OutlineCorruptError(this.filePath, 'file is not valid JSON', { cause: err });
    }
    const parsed = OutlineDocSchema.safeParse(json);
    // Never silently reset corrupt data: surface it so the caller (agent/reset) decides.
    if (!parsed.success) {
      throw new OutlineCorruptError(this.filePath, parsed.error.message);
    }
    return parsed.data;
  }

  // Crash-safe write: tmp file + rename avoids a truncated outline.json.
  private async writeAtomic(doc: OutlineDoc): Promise<void> {
    const text = `${JSON.stringify(doc, null, 2)}\n`;
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, text, 'utf8');
      await fs.rename(tmp, this.filePath);
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }
}
