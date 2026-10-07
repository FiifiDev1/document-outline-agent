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

This is the part I thought about most, so here's the honest version — what I picked, what I passed up, and why.

**Tools speak in IDs, even though users never do.** Nobody types "move a1 to 6" — people say "move the intro to the end." So why do five of the six tools only accept IDs? I considered the friendlier-sounding option: let the tools accept titles and fuzzy-match them behind the scenes. It would save a round-trip per turn. But fuzzy matching sweeps ambiguity under the rug, and ambiguity is the whole test here. "Delete the pricing slide" matches two items; "move the appendix" matches zero. A fuzzy tool would have to guess, and a wrong guess on a delete is the worst outcome in the app. Strict IDs force the agent to look at the real outline first (`list-outline`), decide what you meant, and — when it genuinely can't tell — ask you instead of gambling. One extra tool call per turn is a tiny price for that.

**Every tool answer includes the fresh outline.** Each result comes back as `{ ok, [details], outline }` with current positions, even `list-outline` itself. The alternative was slim responses ("done, moved it") plus re-listing whenever the agent needed positions again. That falls apart on multi-step turns: in "move Competitive Analysis to the top and rename it," the rename needs positions *after* the move, and a move can shift everything. Handing back fresh state with every call makes "use the latest outline, not the one from a minute ago" the easy default — the system prompt and the `move-item` description both reinforce it.

**Errors come with a way out.** An unknown ID doesn't just say "not found" — it lists what's actually available (`available: [{position, id, title}]`), so the agent can correct itself in its very next call instead of starting over. Deletes go one step further: partial matches report `{ deleted, notFound }`, and only a total miss is an outright failure. Errors are part of the agent's reading material, so I wrote them like it.

**When unsure, the agent asks — in plain words.** If your request matches two items, it asks which one you meant (naming both) and touches nothing. If it matches nothing, it says so and shows you what's there. There's no fancy approval machinery behind this: "asking" is just a reply that ends with a question mark, and your answer arrives as the next message on the same conversation thread, right where things left off. I verified this live — "Delete the pricing slide" got a question, "Pricing Overview." deleted exactly that item. The road not taken was having the agent pick the likelier match. For anything destructive, I'd rather be asked a slightly annoying question than watch the wrong slide disappear.

**Streaming is events, not polling.** As the agent works, the backend forwards two kinds of live activity: word-by-word reply tokens and tool start/finish markers ("calling update-item… done"). I used LangGraph's `streamEvents` rather than the `streamMode` approach in my original plan — it maps one-to-one onto what the UI needs, with no reassembly required. Tool inputs and outputs stay out of the stream (they'd just be noise; they already shape the reply and the outline). Each turn closes with a fresh `outline` event and a `done` carrying the thread ID, so the left panel is never guessing.

**"Start over" means generate, then replace — carefully.** `create-outline` asks the model for a JSON-only list of slide titles and descriptions, cleans up the response (code fences and all), validates it strictly, and retries once with a firmer "JSON only, please" before giving up. If both attempts fail, your existing outline is left completely untouched. And when generation succeeds, the new outline replaces everything in a single save — old items are gone, new IDs throughout, never a mix of old and new.

**Reset means a fresh conversation too.** Restoring the seed data wasn't enough: the agent still *remembered* the deleted items from earlier in the conversation, which would have confused every turn after a reset. So the Reset button restores the file *and* starts a new conversation thread (clearing the chat). This is also what makes the eleven-prompt test script repeatable — fresh data, fresh memory, every time.

**Saving is boring on purpose.** Every change funnels through one store that writes to a temp file and renames it into place (so a crash can't leave half a JSON file behind), queues concurrent writes so they can't interleave, recreates the seed on a fresh checkout, and shouts loudly about corruption instead of quietly resetting your data.

**Same agent setup as production.** I kept deepagents' default harness (planning, virtual files, subagents) rather than stripping it down, since the brief says this mirrors the production setup — the "six tools" rule covers the tools I defined, and I added no seventh. One versioning lesson: `^1.10.0` silently installs 1.14.x, so the pin is exact (`1.10.8`), which in turn required the LangChain core-v1 dependency family. And two separate afternoons of confusion traced back to one culprit — the `tsx` runner drops decorator metadata, which is why you'll see explicit `@Inject()` on every constructor, explicit `type:` on every API property, and hand-rolled validation on the chat endpoint (framework pipes provably never run there).

**Export reads the file, not the screen.** The Markdown download renders from `outline.json` on disk. The panel could theoretically be a step behind; the file can't be.

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
