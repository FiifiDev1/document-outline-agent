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

## Design Decisions and Reasons

**Tools use IDs for mutations.** The user speaks in titles, but the tools use IDs. I considered fuzzy title matching, but it makes ambiguous requests risky — especially deletes. The agent first reads the outline, resolves the title to an ID, and asks when it genuinely cannot tell.

**Successful tool calls return the fresh outline.** This makes multi-step requests safer. After a move, for example, the next operation gets the new positions instead of relying on stale state.

**The agent asks instead of guessing.** For ambiguous requests such as “delete the pricing slide,” it names the matching items and waits for the user. For a missing item, it explains what is actually in the outline. I preferred a small interruption over making a destructive guess.

**Streaming uses `streamEvents`.** The UI needs two things while a turn runs: assistant tokens and tool activity. `streamEvents` maps cleanly to those events, then the server sends the final outline so the left panel always catches up with the source of truth.

**The file store is simple, but deliberately safe.** `outline.json` is enough for this exercise, so I did not introduce a database. Writes are serialized and use temp-file + rename, and invalid data is surfaced rather than silently replaced.

**Generating a new outline is all-or-nothing.** The model gets two chances to return valid JSON. I validate the result before replacing the existing outline, so a bad model response cannot wipe out the current state.

**Reset clears both data and conversation state.** Restoring the file alone is not enough because the agent could still remember the old outline. The UI therefore resets the seed and starts a new thread together.

**I kept the default deepagents setup and pinned the version.** The brief calls for the same general harness used in production, so I kept its defaults rather than building a stripped-down agent. `deepagents` is pinned to `1.10.8` to avoid unexpected changes from a floating minor/patch version.

**A few NestJS details are explicit on purpose.** The project runs through `tsx`, so decorator metadata is not available in the usual way. That is why dependency injection, Swagger property types, and chat validation are handled explicitly where needed.

**Export reads from disk.** The Markdown export uses `outline.json` rather than frontend state, so the exported document comes from the same source of truth as the backend.

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