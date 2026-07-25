# StoryVerse integration contracts

## Product flow

1. The product home renders only explanatory content and saved user-created worlds.
2. `POST /api/worlds` persists a brief and returns a world record.
3. `GeneratedWorldReader` bootstraps the selected world’s Chapter 1 through the story API.
4. All chapters, perspectives, image records, and narration assets remain scoped to that world ID.

## Core data boundaries

- A world brief, canonical chapter, character perspective, image prompt, and narrated text are distinct records.
- Image prompts are rebuilt server-side from persisted world/chapter context; clients cannot supply arbitrary provider prompts.
- Character perspectives use the selected character’s generated context and must not be labelled or narrated as the canonical view.
- Narration uses the exact visible source text identified by its content hash.

## UI boundary

`StoryExperience` owns the product home and world-creation experience. `GeneratedWorldReader` owns an opened world’s chapter, perspective, image, BGM, and narration interactions.
