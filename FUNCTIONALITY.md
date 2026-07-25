# StoryVerse — Working Functionality

This document describes the features implemented in the current StoryVerse application. The product contains no preloaded fictional universe: all visible worlds originate from user-created briefs.

## Product home and use cases

- Professional product home explaining how StoryVerse is used: create a world, shape a serial, explore character perspectives, and direct change through natural-language commands.
- Direct calls to action for **Create a world** and **Explore worlds**.
- Empty, loading, error, and keyboard-accessible states for the World Atlas.

## World creation and archive

- Create a world with a title, genre, core premise, and creative direction.
- Persist worlds in SQLite and revisit them through the World Atlas.
- Generate an original opening moment and central cast with OpenAI when configured.
- Keep the creator’s brief as a safe fallback if provider generation is unavailable.
- Remove the retired legacy demo record from existing local databases without affecting user-created worlds.

## Persistent story reader

- Generate and save Chapter 1 for each created world.
- Generate next chapters while passing the saved world state, character descriptions, goals, memories, and prior chapter context.
- Apply an author command to direct the next chapter.
- Browse previous and next saved chapters without regenerating them.
- View canonical narration or generate a selected character’s current-chapter perspective.
- Keep character perspective text, image beats, and narration source aligned.

## Visual storytelling

- Generate a world cover, chapter illustrations, and character-perspective illustrations from approved persisted story context.
- Keep visual prompts generic to the creator’s world; no legacy cast, setting, or plot is embedded in image prompts.
- Persist image metadata in SQLite and assets under `data/story-images/`.
- Reuse saved images when returning to earlier chapters and show an immediate resilient fallback while an illustration is loading or unavailable.

## Audio storytelling

- Use chapter context to choose one local CC0 BGM track from reflection, suspense, danger, conflict, grief, or triumph.
- Generate exact-text narration with `gpt-4o-mini-tts` for the visible canonical or selected-character prose.
- Verify the selected narration source through a content hash before playback.
- Cache WAV narration under `data/story-narrations/` for later playback.
- Provide Prepare, Play/Pause, Restart, and live speed controls: `0.75×`, `1×`, `1.25×`, `1.5×`, and `2×`.

## Backend and persistence

- Express API with structured request validation and JSON responses.
- SQLite storage for worlds, world stories, perspectives, image cache metadata, and migration-safe legacy cleanup.
- API request logging with request IDs, method, path, status, and duration.
- Server-side provider keys only; browser clients never receive raw model credentials or unrestricted image prompts.

## Key endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Check API, SQLite, and model configuration state |
| `GET` | `/api/worlds` | List saved user-created worlds |
| `POST` | `/api/worlds` | Create and persist a world brief |
| `POST` | `/api/worlds/:worldId/story/bootstrap` | Generate or retrieve Chapter 1 |
| `POST` | `/api/worlds/:worldId/story/next` | Generate and save the next chapter |
| `POST` | `/api/worlds/:worldId/story/command` | Apply an author direction to the next chapter |
| `POST` | `/api/worlds/:worldId/story/perspective` | Generate a character’s saved current-chapter perspective |
| `POST` | `/api/images/generate` | Generate/retrieve an approved generic story image |
| `POST` | `/api/worlds/:worldId/story/audio-plan` | Get BGM and narration metadata for the visible source |
| `POST` | `/api/worlds/:worldId/story/narration` | Generate/retrieve exact-text WAV narration |

## Current boundaries

- No authentication, payments, sharing, or multiplayer collaboration.
- No arbitrary branching or branch merging for created worlds yet.
- Live generative text, images, and narration require a configured provider key.
