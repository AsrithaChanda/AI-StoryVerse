# Story image integration contract

- Shared client type: `src/images/contracts.ts` (lead owned).
- Pipeline/API/SQLite cache: Agent A owns `server/images/**`, `server/image-routes.ts`, and `server/worlds.ts`.
- Visual image components: Agent B owns `src/components/SceneImage.tsx`, `src/components/WorldImage.tsx`, and `src/styles/images.css`.
- Tests and E2E documentation: Agent C owns `server/images.test.ts` and `e2e/story-images.md`.
- Lead owns API mounting, controller/UI composition, metadata, docs, review, and build fixes.

Images are optional and asynchronous. The reducer commits canonical consequences first; image work is never an input to story state.
