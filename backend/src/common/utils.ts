import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { OutlineDoc, PositionedItem } from '../outline/outline.types';

// Positions are derived from array order (1-indexed), never stored.
export function withPositions(doc: OutlineDoc): PositionedItem[] {
  return doc.items.map((item, i) => ({ ...item, position: i + 1 }));
}

// Canonical 6-item seed from TASK.pdf. Returns a fresh copy each call.
export function seedOutline(): OutlineDoc {
  return {
    items: [
      { id: 'a1', title: 'Introduction', description: 'Set context and agenda.' },
      { id: 'b2', title: 'Market Landscape', description: 'Size, growth, key segments.' },
      { id: 'c3', title: 'Pricing Overview', description: 'Headline pricing model.' },
      { id: 'd4', title: 'Competitive Analysis', description: 'How we compare to alternatives.' },
      { id: 'e5', title: 'Pricing Details', description: 'Tiers, discounts, terms.' },
      { id: 'f6', title: 'Next Steps', description: 'Owners and timeline.' },
    ],
  };
}

// Backend runs with cwd=backend/ (dev and prod), so the repo-root file is one level up.
export function resolveOutlinePath(): string {
  const override = process.env.OUTLINE_PATH;
  if (override && override.trim().length > 0) return path.resolve(override);
  if (path.basename(process.cwd()) === 'backend') {
    return path.resolve(process.cwd(), '..', 'outline.json');
  }
  return path.resolve(process.cwd(), 'outline.json');
}

// Short random id not present in `existing` (seed ids look like "a1", "b2").
export function newItemId(existing: string[]): string {
  const taken = new Set(existing);
  for (;;) {
    const candidate = randomUUID().replace(/-/g, '').slice(0, 4);
    if (!taken.has(candidate)) return candidate;
  }
}
