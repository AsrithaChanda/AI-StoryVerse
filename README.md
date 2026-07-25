# StoryVerse

StoryVerse is an AI-native story creation studio for building original, persistent story worlds. A creator supplies a title, genre, core premise, and creative direction; StoryVerse saves the world, generates a cinematic Chapter 1, and supports ongoing chapters, character perspectives, illustrations, narration, and scene-aware background music.

No prewritten or seeded story universe is included. The archive starts empty and contains only worlds created by the user.

## What creators can do

- Create an original world from a short creative brief.
- Browse and reopen worlds in the persistent World Atlas.
- Generate a Chapter 1 with a persistent, uncapped cast, chapter beats, and world state.
- Revise the latest chapter in place with a natural-language prompt. The replacement keeps the same chapter number and continuity, clears stale character POVs, receives new visual/audio identities so older assets cannot be reused accidentally, and may introduce new persistent characters.
- Queue multiple upcoming directions, including any number of character introductions. The queue is saved with the world, injected into the next chapter's model context, and cleared only after that chapter is successfully persisted. New characters returned by the structured generation are added to the persistent cast for later chapters and POVs.
- Continue the story chapter by chapter with live draft prose streaming into a clear generation stage before the canonical chapter is saved.
- Browse the whole persistent cast in a searchable directory, then switch the current chapter to any selected character’s point of view with the same progressive loading treatment.
- Generate and cache cinematic illustrations for chapter beats and character perspectives.
- Listen to the displayed canonical or character-perspective prose with selected narration speed and restart controls.
- Hear a scene-appropriate local BGM track selected by the chapter-audio director.

## Quick start

```bash
npm install
cp .env.example .env
npm run dev
```

Open the local Vite URL shown in the terminal. The API creates `data/storyverse.db` automatically.

## Optional environment

Add `OPENAI_API_KEY` to `.env` to enable live world, chapter, perspective, image, and narration generation. Credentials remain server-side.

- `OPENAI_MODEL` — structured world and chapter generation (configured for `gpt-5.6-luna`)
- `OPENAI_IMAGE_MODEL` — image generation
- `STORYVERSE_IMAGE_QUALITY` — optional `low`, `medium`, or `high` image quality (`low` prioritizes visual turnaround over detail)
- `OPENAI_NARRATION_MODEL` — exact-text narration through `gpt-4o-mini-tts`

Without a key, creators can still save and browse world briefs. Live Chapter 1, perspective, illustration, and narration generation require the configured provider.

## Architecture

- `src/components/StoryExperience.tsx` — professional product home, use cases, World Atlas, and world-creation dialog.
- `src/components/GeneratedWorldReader.tsx` — chapter reader, character perspective switcher, chapter-revision and upcoming-direction controls, archive navigation, images, BGM, and narration controls.
- `server/story-routes.ts` — chapter, perspective, revision, and upcoming-direction APIs.
- `server/` — Express API, structured generation, safe Responses-API streaming, image pipeline, chapter-audio director, and SQLite persistence.
- `data/storyverse.db` — local archive for worlds, persistent chapters, perspectives, and image metadata.
- `data/story-images/` and `data/story-narrations/` — persisted generated assets.

## Commands

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Current scope

StoryVerse currently supports linear, persistent chapter continuations per created world. For continuity safety, only the latest chapter can be revised; archived chapters remain read-only once a later chapter exists. Authentication, payments, collaboration, world sharing, and arbitrary branch/merge editing are intentionally outside this build.

## Authoring APIs

- `POST /api/worlds/:worldId/story/directions` — persist a 3–1000 character upcoming direction.
- `POST /api/worlds/:worldId/story/next/stream` — generate the next chapter using the saved direction queue; successful output consumes the queue and saves any structured new cast members.
- `POST /api/worlds/:worldId/story/revise/stream` — stream and save a replacement for the latest canonical chapter.

The direction queue and chapter revision are stored inside the existing SQLite `world_stories` record. No client-side-only state is relied on, so a refresh preserves queued instructions and revised chapters.
