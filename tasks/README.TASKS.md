# Tasks Log

Convention (system prompt for this session):

1. Work comes from `Tasks.md` (T0.1 … T7.4).
2. Before implementing a task, create `tasks/task<N>-<slug>.md` with:
   - Goal
   - Plan / steps
   - Files to touch
   - Risks / edge cases
3. After implementing, update the same file with:
   - What was done
   - How it was verified (commands, outputs)
   - Follow-ups / gaps
4. One file per task. Example: `tasks/task1-monorepo-scaffold.md`.
5. Keep each file short and factual. No emojis.
6. Mark progress in `Tasks.md` (`[x]`) when done.

Naming: `task<seq>-<short-slug>.md` where `<seq>` increments in implementation order.
Map to `Tasks.md` ID inside the file (e.g. `Task-ID: T0.1`).
