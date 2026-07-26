# AI Story Director

The AI Story Director is a bounded chapter-editing agent. It turns a director instruction such as “slow the pacing”, “make Kael more sympathetic”, or “foreshadow the betrayal” into a reviewable proposal before it can change a story.

## Scope boundary

The agent receives only:

- the currently selected canonical chapter (`title`, `narration`, visual beats, audio direction, revision, and its local closing handoff);
- the creator’s 3–600 character direction.

It deliberately does **not** receive or invoke the next-chapter generator, character POV generator, world builder, queued directions, world-state summary, prior/future chapters, character-memory archive, or image/narration controls. It has no tools and cannot make persistence or media calls.

This means its vision is strictly: *make this one displayed canonical chapter read differently*. It cannot introduce a persistent character, alter relationship/memory state, rewrite the wider world, or plan the next chapter.

## Interaction flow

```text
Creator direction
       │
       ▼
Chapter-scoped Director agent
  (proposal only; no database write)
       │
       ▼
Structured proposal
  intent + affected scenes + rationale + complete candidate chapter
       │
       ├── Discard ──► unchanged chapter
       │
       └── Apply ──► validate current chapter identity/revision
                         │
                         ▼
                    atomically replace only that chapter
                    invalidate its stale POVs
                    prepare new chapter images and a refreshed audio plan
```

## Proposal contract

Each proposal is bound to one `chapterId` and `baseRevision`. It contains:

- `directorIntent` — a concise explanation of the intended reading effect;
- `changes[]` — structured `pacing`, `characterization`, `foreshadowing`, `tone`, `imagery`, or `scene_order` changes, each naming affected existing beat IDs;
- `proposedChapter` — a complete replacement chapter with three to four new visual beats, refreshed audio direction, and a local closing handoff (`resolvedBeat`, `closingImage`, `nextChapterHook`, and carry-forward facts).

The server validates the proposal again on apply. It rejects a stale revision, a different chapter, changed chapter number, unknown affected beat, an unfinished final sentence, invalid beat/audio/handoff shape, or any attempt to modify data outside the selected chapter.

## Persistence behavior

Applying a proposal:

1. replaces only the latest canonical chapter in the story aggregate;
2. retains the cast, world state, queued directions, and all other chapters exactly as stored;
3. clears saved character perspectives for that chapter because they describe the superseded canonical text;
4. gives the replacement a new revision and scene IDs, so old images/audio cannot be mistakenly reused;
5. uses the existing atomic version check in PostgreSQL/Lakebase when concurrent edits are enabled.

The proposal itself is not persisted. A creator must explicitly apply it, and a stale proposal cannot overwrite a newer chapter.

## UI boundary

The AI Story Director is its own compact panel in the canonical latest-chapter reader. It is not part of the existing next-chapter, future-direction, world-creation, or character-POV controls. While a character lens is active or an older chapter is selected, the panel is unavailable; the creator first returns to the current canonical chapter.
