# Document-Outline Agent (Marvin take-home)

A two-panel web app: document outline on the left, agent chat on the right.
Plain-English instructions → agent tool calls → outline updates, streamed live.

## Run from a clean checkout

Prerequisites: Node >= 20, an Anthropic API key.

```bash
git clone <repo> && cd document-outline-agent
npm install
cp .env.example .env   # then put your key in .env: ANTHROPIC_API_KEY=...
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001/api (Swagger UI at `/api/docs`)
- The backend reads `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` from `backend/.env`
  if present, else the repo-root `.env` (explicit `configFilePath`; real env
  vars always win over both files).
- `outline.json` at the repo root is the entire database. Missing file on first
  run is recreated from the 6-item seed; a corrupt file returns a 500 pointing
  at `POST /api/outline/reset` (never silently overwritten).
- No key? The app still boots; health, outline, docs, and export work. Only
  agent turns refuse (503) until a key is configured.

Useful endpoints: `GET /api/outline`, `POST /api/outline/reset` (restore seed),
`GET /api/outline/export` (`outline.md` download), `POST /api/chat` (SSE).

## Design decisions and why

**ID-only tools, list-first grounding.** The five mutating tools take item IDs,
never titles — even though users never type IDs. The alternative was fuzzy
title-matching inside the tools (forgiving, fewer round-trips). I dropped it:
fuzzy matching hides ambiguity instead of resolving it, and it would have made
prompts #3 ("pricing slide" → two matches) and #10 ("appendix" → zero matches)
ungradeable coin flips. Strict IDs force the agent to ground via `list-outline`
first, which makes the ask-vs-act decision explicit and visible in the transcript.
The cost (one extra tool call per turn) is negligible next to an LLM round-trip.

**Uniform `{ ok, [detail], outline }` envelope.** Every tool result — including
`list-outline` — carries the fresh positioned outline. The alternative was
minimal return values plus re-listing between chained calls. That doubles tool
calls on multi-step turns (#8 move + rename) and risks acting on stale
positions: between two moves, every position may have shifted. Returning fresh
state makes "use the latest outline, not the original list" cheap to obey, and
the system prompt + `move-item` description both say so.

**`item_not_found` returns the available items.** An unknown ID yields
`{ ok: false, error, available: [{position, id, title}] }` instead of a bare
error. The model can self-correct in the next call without another
`list-outline` round-trip. Same shape on update/move/delete; delete's full-miss
is `ok: false`, partial misses are `ok: true` with `{ deleted, notFound }`.

**Ask, don't guess — as plain text.** On multi-match (#3) the agent asks a
question naming the candidates and makes zero tool calls; on zero-match (#10)
it explains and lists options. "Asking" is just a text reply ending in a
question — no interrupt/HITL machinery. The follow-up arrives as the next
message on the same checkpointer thread and continues the task (verified live:
"Pricing Overview." deleted exactly that item). The dropped alternative was
picking the most likely match; for destructive actions a wrong guess is worse
than a question, and the task explicitly rewards asking over guessing.

**Streaming via `streamEvents` v2, not `streamMode`.** The plan said
`agent.stream({ streamMode: ['messages','updates'] })`. In practice `streamEvents`
maps 1:1 onto the required UI events (`on_chat_model_stream` → tokens,
`on_tool_start/end` → activity) without reassembling node updates. Text-only
content is forwarded; tool payloads are deliberately excluded from the stream
(they already shape the reply + outline). The turn ends with a fresh `outline`
event (single source of truth, no polling) and `done{threadId}`.

**`create-outline` generates, then replaces in one write.** The sub-model call
asks for a JSON-only array, strips fences, validates strictly with Zod, retries
once with a "JSON only" nudge, and on double failure returns `generation_failed`
with the existing outline untouched. Parsing is lenient, acceptance is strict,
and ids are assigned before the single `save()` — never merged with old items.

**Reset rotates the thread.** `POST /api/outline/reset` (and the UI button)
restores data, but the agent's thread memory still references deleted items, so
the frontend also starts a fresh `threadId` and clears the chat. Reset =
fresh data + fresh conversation, which is also what makes the 11-prompt script
repeatable.

**Persistence: tmp-file + rename, mutex-chained.** All writes go through one
`OutlineStore`: atomic rename (no truncated JSON on crash), a promise-chain
mutex (concurrent tool calls in one turn can't interleave load→save), first-run
seeding, and loud corruption errors instead of silent resets.

**Kept the default deepagents harness.** `createDeepAgent({ model, tools,
systemPrompt, checkpointer })` with default middleware (todos, virtual
filesystem, subagents) — production parity per the brief. The "six tools" rule
covers domain tools; nothing custom was added. The virtual FS backend can't
touch `outline.json` on disk, so tools can't be bypassed. Pinned
`deepagents@1.10.8` exactly: `^1.10.0` floats to 1.14.x, breaking the 1.10.x
spec, and 1.10.6+ requires the LangChain core-v1 stack (`@langchain/core` 1.2.x,
`@langchain/anthropic` 1.5.x, `zod` v4) — the legacy 0.3.x line erezolve-conflicts.

**Two tsx gotchas, one root cause.** tsx/esbuild drops decorator metadata, so
(1) Nest constructor injection needs explicit `@Inject()` everywhere
(silent `undefined`, 500s otherwise), and (2) every `@ApiProperty` needs an
explicit `type:` (swagger hallucinated a circular dependency). Related:
`ValidationPipe` never fires without `transform: true`, and pipes don't run at
all on `@Res()`-manual-mode routes (verified: global and method-level both
returned 200 for `{}`) — so the chat endpoint validates with class-validator
directly and returns 400 itself.

**Export reads the file, not the panel.** `GET /api/outline/export` renders
Markdown from disk. Panel state could be stale; the file can't be.

## What I'd do with more time

- **Durable checkpointer.** `MemorySaver` loses threads on restart — fine for a
  review session, wrong for production. File-backed (or Postgres) checkpointer,
  plus a thread list/resume UI.
- **Tests.** Promote the `backend/scripts/verify-t*.ts` ad-hoc scripts into a real
  runner (vitest): tool unit tests with an isolated store, prompt regression
  tests with a recorded-model cassette, and an automated 11-prompt runner
  asserting end-states instead of a hand-run transcript.
- **Chat hardening.** Auth/rate-limiting on `/api/chat`, token/cost display per
  turn, client reconnect/resume on dropped SSE, and structured (non-string) tool
  results once the frontend renders richer cards.
- **Richer replies.** Render the assistant's Markdown (bold/lists already appear
  as raw `**`), optimistic outline updates, and per-item edit affordances that
  still route through the agent (keeping the transcript honest).
- **Model flexibility.** The provider is already behind `LlmConfig`, but only
  Anthropic is wired. A `MODEL_PROVIDER` switch (Anthropic/OpenAI) plus a
  no-key demo mode with scripted responses would make review possible without
  spending key credit.

## Verification status

- `tsc --noEmit` clean (backend + frontend), `vite build` clean.
- All six tools exercised directly against isolated stores (see
  `backend/scripts/verify-t*.ts`); agent traps (#3 ask, #10 no-op, follow-up
  continuity, cross-turn recall) verified live; SSE verified with curl
  (tokens, tool bracketing, 400s, thread echo).
- The 11-prompt session + `TRANSCRIPT.md` + screen recording remain (Phase 6/7).
