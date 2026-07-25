# StoryVerse

StoryVerse is an AI-native story creation studio for building original, persistent story worlds. A creator supplies a title, genre, core premise, and creative direction; StoryVerse saves the world, generates a cinematic Chapter 1, and supports ongoing chapters, character perspectives, illustrations, narration, and scene-aware background music.

No prewritten or seeded story universe is included. The archive starts empty and contains only worlds created by the user.

## What creators can do

- Create an original world from a short creative brief.
- Browse and reopen worlds in the persistent World Atlas.
- Generate a Chapter 1 with a persistent cast, chapter beats, and world state.
- Continue the story chapter by chapter or direct the next chapter with an author command; live draft prose streams into a clear generation stage before the canonical chapter is saved.
- Switch the current chapter to a selected character’s point of view, with the same progressive loading treatment.
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
- `src/components/GeneratedWorldReader.tsx` — chapter reader, character perspective switcher, author commands, archive navigation, images, BGM, and narration controls.
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

StoryVerse currently supports linear, persistent chapter continuations per created world. Authentication, payments, collaboration, world sharing, and arbitrary branch/merge editing are intentionally outside this build.
