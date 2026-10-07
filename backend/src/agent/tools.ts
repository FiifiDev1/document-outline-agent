import { tool } from 'langchain';
import * as z from 'zod';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { OutlineStore } from '../outline/outline.store';
import { newItemId, withPositions } from '../common/utils';

export interface OutlineToolDeps {
  store: OutlineStore;
  // Model used ONLY by create-outline to generate items. Optional so the
  // other five tools stay testable without credentials.
  model?: BaseChatModel;
}

// All tools return a JSON string with envelope { ok, [detail], outline }.
// Every result carries the fresh positioned outline so chained calls
// always work from current positions.
export function createOutlineTools(deps: OutlineToolDeps) {
  const { store, model } = deps;

  const listOutline = tool(
    async () => {
      const doc = await store.load();
      return JSON.stringify({ ok: true, outline: withPositions(doc) });
    },
    {
      name: 'list-outline',
      description:
        'Returns the full document outline as { ok, outline: [{ position, id, title, description }] }. ' +
        'Positions are 1-indexed in the current array order. ' +
        'Call this before any add/update/move/delete to resolve the user\'s words to an item ID. ' +
        'Never invent IDs: use exactly the id strings returned here (short codes like "a1").',
      schema: z.object({}),
    },
  );

  const addItem = tool(
    async ({ title, description, position }: { title: string; description?: string; position?: number }) => {
      let createdId = '';
      const next = await store.update((doc) => {
        createdId = newItemId(doc.items.map((i) => i.id));
        const item = { id: createdId, title, description: description ?? '' };
        // 1-indexed: missing or past-the-end appends, below 1 clamps to top.
        const at = position === undefined || position > doc.items.length + 1 ? doc.items.length : Math.max(0, position - 1);
        doc.items.splice(at, 0, item);
        return doc;
      });
      const items = withPositions(next);
      return JSON.stringify({ ok: true, item: items.find((i) => i.id === createdId), outline: items });
    },
    {
      name: 'add-item',
      description:
        'Inserts a new outline item as { title, description?, position? }, adding to the existing outline without removing anything. ' +
        'Position is 1-indexed: omit it (or pass past the end) to append, pass 1 for the top. ' +
        'Resolve anchors like "before Next Steps" to a number yourself from list-outline first; this tool only takes numbers.',
      schema: z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        position: z.number().int().optional(),
      }),
    },
  );

  const updateItem = tool(
    async ({ id, title, description }: { id: string; title?: string; description?: string }) => {
      if (title === undefined && description === undefined) {
        return JSON.stringify({ ok: false, error: 'nothing_to_update', hint: 'pass a new title and/or description' });
      }
      let updatedId = '';
      try {
        const next = await store.update((doc) => {
          const target = doc.items.find((i) => i.id === id);
          // Unknown ID: report who is available so the agent can self-correct.
          if (!target) throw new Error(`item_not_found:${id}`);
          if (title !== undefined) target.title = title;
          if (description !== undefined) target.description = description;
          updatedId = id;
          return doc;
        });
        const items = withPositions(next);
        return JSON.stringify({ ok: true, item: items.find((i) => i.id === updatedId), outline: items });
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('item_not_found:')) {
          const doc = await store.load();
          return JSON.stringify({
            ok: false,
            error: 'item_not_found',
            id,
            available: withPositions(doc).map(({ position, id: aid, title: atitle }) => ({ position, id: aid, title: atitle })),
          });
        }
        throw err;
      }
    },
    {
      name: 'update-item',
      description:
        'Edits one item by ID: { id, title?, description? } with at least one of title/description (text only — to move an item, use move-item). ' +
        'Title and description are full replacements, not patches. ' +
        'The id must be a short code from list-outline (like "a1") — never a title and never invented; unknown IDs return the available items so you can retry.',
      schema: z.object({
        id: z.string().min(1),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
      }),
    },
  );

  const moveItem = tool(
    async ({ id, toPosition }: { id: string; toPosition: number }) => {
      let movedId = '';
      let moved = false;
      try {
        const next = await store.update((doc) => {
          const from = doc.items.findIndex((i) => i.id === id);
          // Unknown ID: report who is available so the agent can self-correct.
          if (from === -1) throw new Error(`item_not_found:${id}`);
          // Clamp to the live range; positions are 1-indexed in the current order.
          const at = Math.min(Math.max(0, toPosition - 1), doc.items.length - 1);
          moved = at !== from;
          if (moved) {
            const [item] = doc.items.splice(from, 1);
            doc.items.splice(at, 0, item!);
          }
          movedId = id;
          return doc;
        });
        const items = withPositions(next);
        return JSON.stringify({ ok: true, moved, item: items.find((i) => i.id === movedId), outline: items });
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('item_not_found:')) {
          const doc = await store.load();
          return JSON.stringify({
            ok: false,
            error: 'item_not_found',
            id,
            available: withPositions(doc).map(({ position, id: aid, title: atitle }) => ({ position, id: aid, title: atitle })),
          });
        }
        throw err;
      }
    },
    {
      name: 'move-item',
      description:
        'Moves one item to a target position: { id, toPosition } (to rename or edit text, use update-item). ' +
        'Positions are 1-indexed in the CURRENT order — use the latest outline from your previous call this turn, not the original list. ' +
        'Top is 1, end is the last position you have seen. Out-of-range targets clamp to the nearest end. ' +
        'The id must be a short code from list-outline — never a title and never invented; unknown IDs return the available items so you can retry.',
      schema: z.object({
        id: z.string().min(1),
        toPosition: z.number().int().min(1),
      }),
    },
  );

  const deleteItem = tool(
    async ({ ids }: { ids: string[] }) => {
      // Dedupe so a repeated id is reported once and cannot double-delete.
      const wanted = [...new Set(ids)];
      const before = await store.load();
      const known = new Map(before.items.map((i) => [i.id, i.title]));
      const found = wanted.filter((id) => known.has(id));
      const missing = wanted.filter((id) => !known.has(id));
      // Full miss: report who is available so the agent can self-correct. Nothing written.
      if (found.length === 0) {
        return JSON.stringify({
          ok: false,
          error: 'items_not_found',
          ids: wanted,
          available: withPositions(before).map(({ position, id: aid, title: atitle }) => ({ position, id: aid, title: atitle })),
        });
      }
      const next = await store.update((doc) => {
        doc.items = doc.items.filter((i) => !found.includes(i.id));
        return doc;
      });
      const items = withPositions(next);
      return JSON.stringify({
        ok: true,
        deleted: found.map((id) => ({ id, title: known.get(id) })),
        notFound: missing,
        outline: items,
      });
    },
    {
      name: 'delete-item',
      description:
        'Removes items by ID array: { ids: [id, ...] }. Destructive — only call for items the user named or confirmed. ' +
        'IDs must be short codes from list-outline. Reports { deleted, notFound }; when nothing matches, ok is false with the available items listed.',
      schema: z.object({
        ids: z.array(z.string().min(1)).min(1),
      }),
    },
  );

  const GeneratedItemsSchema = z.array(
    z.object({ title: z.string().min(1), description: z.string() }),
  );

  // Asks the model for a JSON array of {title, description}. Retries once on
  // malformed output; throws Error('generation_failed') when both attempts fail.
  async function generateItems(model: BaseChatModel, topic: string, count: number) {
    const base =
      `Generate a presentation document outline about: "${topic}". ` +
      `Return ONLY a JSON array with exactly ${count} items, each {"title": "...", "description": "..."}. ` +
      'Titles are short slide titles; descriptions are one or two sentences. ' +
      'No prose, no code fences, just the array.';
    for (const prompt of [base, `${base} Your previous reply was not a JSON array. Reply with the JSON array only.`]) {
      const raw = await model.invoke(prompt);
      const text = typeof raw.content === 'string'
        ? raw.content
        : raw.content.filter((b): b is { type: 'text'; text: string } => b.type === 'text').map((b) => b.text).join('\n');
      const fenced = text.replace(/```(?:json)?/gi, '');
      const json = fenced.slice(fenced.indexOf('['), fenced.lastIndexOf(']') + 1);
      try {
        const parsed = GeneratedItemsSchema.parse(JSON.parse(json));
        if (parsed.length > 0) return parsed;
      } catch {
        continue;
      }
    }
    throw new Error('generation_failed');
  }

  const createOutline = tool(
    async ({ topic, itemCount }: { topic: string; itemCount?: number }) => {
      if (!model) {
        return JSON.stringify({ ok: false, error: 'model_not_configured', hint: 'create-outline needs a chat model' });
      }
      const count = itemCount ?? 6;
      let generated;
      try {
        generated = await generateItems(model, topic, count);
      } catch {
        // Generation failed twice: existing outline untouched.
        return JSON.stringify({ ok: false, error: 'generation_failed', hint: 'the current outline was left unchanged' });
      }
      // Full replace with fresh ids — never merged with existing items. Single write.
      const taken: string[] = [];
      const next = await store.save({
        items: generated.map((g) => {
          const id = newItemId(taken);
          taken.push(id);
          return { id, title: g.title.trim(), description: g.description.trim() };
        }),
      });
      const items = withPositions(next);
      return JSON.stringify({ ok: true, topic, outline: items });
    },
    {
      name: 'create-outline',
      description:
        'Starts over with a fresh outline about a topic: { topic, itemCount? } (3-10, default 6). ' +
        'The items are generated, and the new outline REPLACES the current one — call only when the user asks to start over or create a new outline.',
      schema: z.object({
        topic: z.string().min(1),
        itemCount: z.number().int().min(3).max(10).optional(),
      }),
    },
  );

  return [listOutline, addItem, updateItem, moveItem, deleteItem, createOutline];
}

export type OutlineTools = ReturnType<typeof createOutlineTools>;
