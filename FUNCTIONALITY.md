# StoryVerse — Implemented Functionality

## Product experience

- Cinematic landing page for **The Last Ember**.
- Interactive Eastern Bridge opening scene.
- Deterministic binary decision: **Trust Kael** or **Expose Kael**.
- World-state panel: Ember stability, city alert, Kael status, and location.
- Character memory drawer for Mira, Ravi, and Prince Kael.
- Per-character memories, beliefs, relationships, emotions, and known facts.
- Ravi can become the protagonist without resetting the active continuity.
- Story Time Machine creates Timeline B using the alternate bridge decision.
- Timeline A remains unchanged; users can compare and switch branches.
- Reset Demo returns the experience to its opening state.
- Local browser persistence for the Last Ember story state.
- Responsive visual layout with visible focus states and keyboard-accessible buttons.

## Deterministic story rules

### Trust Kael

- Kael’s trust in Mira: `+25`
- Ravi’s trust in Mira: `-10`
- City alert: `Elevated`
- Kael remains free.
- Mira remembers: “I protected Kael at the bridge.”
- Ravi believes: “Mira may be hiding something.”

### Expose Kael

- Kael’s trust in Mira: `-30`
- Ravi’s trust in Mira: `+15`
- City alert: `Critical`
- Kael is detained.
- Mira remembers: “I exposed Kael to Ravi.”
- Ravi remembers: “Mira trusted me with the truth.”

## Knowledge safety

- Canonical world truth is separate from character beliefs and memories.
- Ravi’s scene context includes only Ravi’s own known facts, memories, and beliefs.
- Kael’s private motive is not exposed to Ravi’s context.

## Scene generation

- Typed scene-generation adapter with Zod schema validation.
- One retry for invalid provider output, timeout, or provider error.
- Prepared, polished fallback scenes make the Last Ember demo work without an API key.
- Optional server-side OpenAI generation for new-world blueprints.
- Optional, server-side story-image generation for world covers, the opening scene, both bridge outcomes, and Ravi’s point of view.
- Persistent SQLite image cache keyed by world, branch, scene, protagonist, and prompt version.
- Immediate cinematic fallback art, non-blocking loading, failure messaging, and guarded manual retry.
- Branch-specific amber Trust Kael and violet Expose Kael imagery; Ravi prompts exclude Kael’s private motive.

## Story-image API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/images/generate` | Generate or retrieve one allow-listed story moment; raw prompts are rejected. |
| `GET` | `/api/images/:sceneId` | Retrieve cached public image metadata. |
| `GET` | `/api/images/cache/:cacheKey` | Retrieve cache metadata by deterministic key. |
| `POST` | `/api/worlds/:worldId/cover` | Create or retrieve a stored world-cover image. |
| `GET` | `/api/images/assets/:filename` | Serve a validated locally persisted generated asset. |

## Chapter audio

- The **chapter-audio director** selects one bundled local CC0 BGM from a seven-track emotional library (reflection, suspense, danger, conflict, grief, and triumph), then assigns a narration persona from the world genre and chapter emotion.
- New chapters include a validated `audioDirection` object from the existing `gpt-5.6-luna` chapter-generation response: primary/secondary emotion, intensity, BGM cue, and narration delivery. Older or offline chapters use the deterministic keyword classifier only as a fallback.
- **Narrate chapter** calls the dedicated `gpt-4o-mini-tts` speech endpoint with the exact saved canonical or selected-character prose, plus the selected voice and delivery instruction. This avoids generative paraphrasing: the cache key includes the text hash, narrator, model, and renderer version. WAV narration is cached locally at `data/story-narrations/` and reused on later plays. Story writing stays on `OPENAI_MODEL=gpt-5.6-luna`.
- The BGM remains local audio because `gpt-audio` is not a music-composition service. The selection and license are documented in [`public/bgm/ATTRIBUTION.md`](public/bgm/ATTRIBUTION.md).

## World Atlas and world creation

- Browse all worlds stored in the API’s SQLite archive.
- Create a new world with:
  - title
  - genre
  - premise
  - creative direction
- Each created world receives an opening scene and three central characters.
- With `OPENAI_API_KEY` configured, OpenAI generates the blueprint.
- Without a key or on a provider failure, the API creates a deterministic fallback blueprint.
- Created worlds can be explored in the World Atlas with their premise, opening moment, and cast.
- Created worlds now bootstrap a persistent AI-written Chapter 1 with three to four persistent original characters, narrated chapter beats, and scene-image requests.
- Character buttons change narration and image beats to the selected character’s saved perspective.
- An author command adds a directed next chapter; **Generate next chapter** continues the serial while preserving cast descriptions, goals, and memories.

## Backend and database

- Express backend in `server/`.
- SQLite database at `data/storyverse.db`, created automatically at first API startup.
- Seeded database record for The Last Ember.
- API endpoints:

  | Method | Endpoint | Purpose |
  | --- | --- | --- |
  | `GET` | `/api/health` | API/database/model configuration health state |
  | `GET` | `/api/worlds` | List stored worlds |
  | `GET` | `/api/worlds/:id` | Load one world |
| `POST` | `/api/worlds` | Create and persist a world blueprint |
| `POST` | `/api/worlds/:worldId/story/bootstrap` | Generate or retrieve persistent Chapter 1 |
| `POST` | `/api/worlds/:worldId/story/perspective` | Generate a saved character point of view |
| `POST` | `/api/worlds/:worldId/story/command` | Apply an author direction as the next chapter |
| `POST` | `/api/worlds/:worldId/story/next` | Generate the next chapter |

## Setup

```bash
npm install
cp .env.example .env
# Add OPENAI_API_KEY to .env if OpenAI world creation is desired.
npm run dev
```

Useful commands:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Validation completed

- TypeScript typecheck passes.
- ESLint passes.
- Production build passes.
- 54 automated tests pass.
- SQLite API smoke test created and persisted a sample world.

## Current boundaries

- The complete decision, protagonist-switching, and Time Machine engine is currently authored for **The Last Ember** only.
- Newly created worlds are persisted, generated/explorable world blueprints; they do not yet receive arbitrary dynamic decision trees or branching gameplay.
- No authentication, payments, multiplayer, or arbitrary-depth branching.
