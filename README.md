# StoryVerse

StoryVerse is an AI-native story creation studio for building original, persistent story worlds. A creator supplies a title, genre, core premise, and creative direction; StoryVerse saves the world, generates a cinematic Chapter 1, and supports ongoing chapters, character perspectives, illustrations, narration, and scene-aware background music.

No prewritten or seeded story universe is included. The archive starts empty and contains only worlds created by the user.

## What creators can do

- Create an original world from a short creative brief.
- Browse and reopen worlds in the persistent World Atlas.
- Generate a Chapter 1 with a persistent, uncapped cast, chapter beats, and world state.
- Finish every newly generated canonical chapter with a resolved immediate beat, a closing image, and a compact carry-forward hook that the next chapter receives as continuity context.
- Revise the latest chapter in place with a natural-language prompt. The replacement keeps the same chapter number and continuity, clears stale character POVs, receives new visual/audio identities so older assets cannot be reused accidentally, and may introduce new persistent characters.
- Use the **AI Story Director** to preview a structured, current-chapter-only edit before applying it. The Director receives only the displayed canonical chapter and its instruction; it cannot inspect or change the cast, world state, character memories, future directions, or any other chapter.
- Remove the current chapter only when it is the latest chapter and a prior chapter exists; the reader returns to that prior chapter.
- While viewing any earlier chapter, prune every later chapter in one confirmed action. The rollback removes deleted chapters' POVs, chapter-introduced cast members, and database image-cache records so a new future starts cleanly.
- Queue multiple upcoming directions, including any number of character introductions. The queue is saved with the world, injected into the next chapter's model context, and cleared only after that chapter is successfully persisted. New characters returned by the structured generation are added to the persistent cast for later chapters and POVs.
- Continue the story chapter by chapter with live draft prose streaming into a clear generation stage. A completed canonical chapter opens only after its complete visual sequence is restored from cache or resolved to ready/fallback frames.
- Browse the whole persistent cast in a searchable directory, then switch the current chapter to any selected character’s point of view with the same progressive loading treatment.
- Generate and cache cinematic illustrations for chapter beats and character perspectives. Content-addressed image URLs are served through the same API from local development storage or a private Databricks Volume in production, then browser-cached for immediate revisits.
- Listen to the displayed canonical or character-perspective prose with selected narration speed and restart controls.
- Hear a scene-appropriate local BGM track selected by the chapter-audio director.

## Quick start

```bash
npm install
cp .env.example .env
npm run dev
```

Open the local Vite URL shown in the terminal. With no PostgreSQL configuration, the API creates `data/storyverse.db` automatically.

## Optional environment

Add `OPENAI_API_KEY` to `.env` to enable live world, chapter, perspective, image, and narration generation. Credentials remain server-side.

- `OPENAI_MODEL` — structured world and chapter generation (configured for `gpt-5.6-luna`)
- `STORYVERSE_STORY_MAX_OUTPUT_TOKENS` — output budget for a complete structured chapter and its closing handoff (default `6000`)
- `OPENAI_IMAGE_MODEL` — image generation
- `STORYVERSE_IMAGE_QUALITY` — optional `low`, `medium`, or `high` image quality (`low` prioritizes visual turnaround over detail)
- `OPENAI_NARRATION_MODEL` — exact-text narration through `gpt-4o-mini-tts`
- `STORYVERSE_DIRECTOR_TIMEOUT_MS` — optional bounded wait for the proposal-only AI Story Director pass (default `45000`)

Without a key, creators can still save and browse world briefs. Live Chapter 1, perspective, illustration, and narration generation require the configured provider.

## Durable storage and deployment

StoryVerse now has a portable persistence boundary:

- **Local/offline:** SQLite plus local generated-media files.
- **Concurrent production traffic:** PostgreSQL with optimistic story-version writes, transactional timeline rollback, and cross-instance image-cache reservation.
- **Databricks:** Lakebase PostgreSQL for transactional world state and a private Unity Catalog Volume for generated images and narration through the Databricks Files API.

Set `DATABASE_URL` (or standard `PG*` values) to select PostgreSQL; otherwise SQLite remains the default. To move media into a Unity Catalog Volume, set `STORYVERSE_ASSET_STORAGE=databricks-volume`, `DATABRICKS_HOST`, `DATABRICKS_VOLUME_PATH`, and—preferably for production—managed-secret `DATABRICKS_CLIENT_ID` plus `DATABRICKS_CLIENT_SECRET`.

StoryVerse exchanges those service-principal credentials for cached workspace OAuth tokens at `<DATABRICKS_HOST>/oidc/v1/token`; the workspace Files API does not require `DATABRICKS_ACCOUNT_ID`. `DATABRICKS_TOKEN` remains a mutually exclusive compatibility fallback for short-lived local/PAT testing, not the recommended production credential. No database or storage credential reaches the client.

See [the deployment guide](docs/deployment.md) for local Docker PostgreSQL testing, Lakebase/Volume preparation, Databricks Apps deployment, security notes, and smoke-test steps.

## Architecture

- `src/components/StoryExperience.tsx` — professional product home, use cases, World Atlas, and world-creation dialog.
- `src/components/GeneratedWorldReader.tsx` — chapter reader, character perspective switcher, Director/direction/rollback controls, archive navigation, images, BGM, and narration controls.
- `src/components/AIStoryDirector.tsx` — isolated review-before-apply Director panel for the current canonical chapter.
- `server/chapter-director.ts` — bounded structured-output Director agent with no world-aggregate context or write capability.
- `server/story-routes.ts` — chapter, perspective, Director proposal/apply, direction, and timeline-rollback APIs.
- `server/persistence/` — PostgreSQL/Lakebase schema, migrations, optimistic concurrency, and the common local/remote store contract.
- `server/storage/` — provider-neutral generated-media store with local filesystem and Databricks Unity Catalog Volume implementations.
- `server/` — Express API, structured generation, safe Responses-API streaming, image pipeline, chapter-audio director, and runtime store selection.
- `data/storyverse.db`, `data/story-images/`, and `data/story-narrations/` — local fallback archive and generated assets (the generic local asset adapter also supports `data/story-assets/` for standalone use).

## Commands

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Current scope

StoryVerse currently supports linear, persistent chapter continuations per created world. PostgreSQL keeps the current canonical story aggregate versioned and media records branch-scoped, so concurrent edits cannot silently overwrite one another and generated media remains continuity-safe. For product scope, arbitrary reader-visible branching/merging is still intentionally outside this build; the AI Story Director can shape only the current canonical chapter, only the latest chapter can be deleted, and any viewed chapter can prune later chapters. Authentication, payments, collaboration, and world sharing are also outside this build.

## Authoring APIs

- `POST /api/worlds/:worldId/story/directions` — persist a 3–1000 character upcoming direction.
- `POST /api/worlds/:worldId/story/next/stream` — generate the next chapter using the saved direction queue; successful output consumes the queue and saves any structured new cast members.
- `POST /api/worlds/:worldId/story/chapters/:chapterId/director/propose` — generate a non-persistent, structured Director proposal for only the current canonical chapter.
- `POST /api/worlds/:worldId/story/chapters/:chapterId/director/apply` — revalidate and atomically apply the reviewed proposal; stale proposals are rejected.
- `DELETE /api/worlds/:worldId/story/chapters/:chapterId` — remove a latest non-initial chapter and return its prior surviving chapter.
- `DELETE /api/worlds/:worldId/story/chapters/:chapterId/future` — retain the selected chapter and remove every later chapter.

The direction queue, Director-applied revisions, and timeline rollback are stored inside the local SQLite record or the PostgreSQL story aggregate. PostgreSQL rollback locks the story row and deletes corresponding `story_images` metadata in the same transaction. No client-side-only state is relied on, so a refresh preserves the resulting timeline.
