# StoryVerse integration contract

## Ownership

| Area | Owner | Allowed paths |
| --- | --- | --- |
| App shell, controller, persistence bridge, metadata, docs | Lead | `src/App.tsx`, `src/main.tsx`, `src/controller.ts`, `src/persistence.ts`, root config/docs |
| Visual UI | Agent A | `src/components/**`, `src/styles/**` |
| Canonical story engine | Agent B | `src/domain/**` |
| AI scene adapter and generation tests | Agent C | `src/ai/**`, `e2e/**` |

## Domain contract (Agent B)

Export `StoryViewState`, `StoryState`, `Decision`, `CharacterId`, `createInitialState`, `commitDecision`, `createAlternateBranch`, `switchBranch`, `switchProtagonist`, `resetStory`, and `getCharacterView` from `src/domain/index.ts`. Reducers are pure and immutable.

## AI contract (Agent C)

Export `SceneGenerationInput`, `GeneratedScene`, `createSceneGenerator`, `buildSceneInput` from `src/ai/index.ts`. The generator must use a no-key fallback by default and never expose Kael's private secret in Ravi inputs.

## UI contract (Agent A)

Export a default `StoryExperience` from `src/components/StoryExperience.tsx` accepting `{ state: StoryViewState; actions: StoryActions }`, with `StoryActions` exported from that file. UI calls only actions and receives no reducer/provider internals.
