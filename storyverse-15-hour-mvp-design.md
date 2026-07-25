# StoryVerse — 15-Hour Hackathon MVP Design

## 1. The product in one sentence

**StoryVerse is an interactive AI story where every character remembers what happened, any side character can become the protagonist, and changing one past decision creates a consistent alternate future.**

This MVP combines only the smallest useful portions of:

- Infinite Story Universe
- Persistent Character Memory
- Story Time Machine

The other ideas remain visible as future-product opportunities but are not implemented.

---

## 2. What the demo must prove

The prototype must demonstrate three things clearly:

1. **The world persists:** a choice changes structured world state.
2. **Characters remember differently:** each character knows and feels different things because of the choice.
3. **History can branch:** changing the choice creates a new future without deleting the original.

If these three moments work convincingly, the project communicates the larger platform vision.

---

## 3. Fixed demo universe

Do not build a general universe creator. Ship one authored seed universe so the experience is reliable and visually polished.

### Universe: The Last Ember

The floating city of **Astra** survives because of the Ember Core beneath its palace. The core is failing. During a public festival, a young courier discovers that someone has stolen a fragment from it.

### Characters

#### Mira Sen — initial protagonist

- Role: palace courier
- Personality: brave, impulsive, compassionate
- Goal: prevent Astra from falling
- Secret: she saw Prince Kael near the vault
- Starting emotion: anxious but determined

#### Ravi — side character who can become the protagonist

- Role: retired royal guard and Mira’s mentor
- Personality: observant, protective, distrustful of authority
- Goal: keep Mira alive
- Memory: the royal family concealed an earlier Ember failure
- Starting emotion: protective and suspicious

#### Prince Kael — suspect

- Role: heir to Astra
- Personality: controlled, idealistic, secretive
- Goal: prevent mass panic
- Secret: he removed the fragment to stop a larger reaction
- Starting emotion: guilty and afraid

### Opening scene

Mira corners Kael at the eastern bridge while warning bells sound. She must choose:

- **Trust Kael** and help him conceal the missing fragment.
- **Expose Kael** to Ravi and the city guard.

Both choices lead to one generated continuation and different state changes.

---

## 4. The five-screen product

### Screen 1 — Universe landing

Purpose: establish the world immediately.

Content:

- Hero title: “The Last Ember”
- One-sentence premise
- Three character portraits or stylized cards
- “Enter the story” button
- Small label: “A living universe — every decision is remembered”

Do not include account creation, onboarding, or story discovery.

### Screen 2 — Interactive story reader

This is the primary screen.

Layout:

- Main column: scene title, narration, and dialogue
- Bottom: two large decision cards
- Right panel: current world state
- Top bar: chapter, current protagonist, and timeline name

World-state panel:

- Ember stability: 42%
- City alert: Elevated
- Kael’s status: Suspected
- Current location: Eastern Bridge

After a decision:

- Show a short “The world changed” animation.
- Highlight two or three state changes.
- Stream or reveal the generated continuation.

### Screen 3 — Character memory

Opened by clicking a character.

Show:

- Personality
- Current goal
- Current emotion
- Known facts
- Beliefs
- Relationship values
- Two or three memories

The important visual comparison:

- Mira knows she saw Kael near the vault.
- Ravi knows the palace hid an earlier failure.
- Kael knows why he removed the fragment.

After the user’s decision, add a clearly highlighted new memory such as:

> Mira protected Kael when the guard arrived.

or:

> Mira exposed Kael despite his warning.

### Screen 4 — Become this character

On Ravi’s memory panel, include:

**Continue as Ravi**

When selected:

- The same world and timeline remain active.
- The narration changes to Ravi’s point of view.
- The prompt receives only Ravi’s knowledge and memories.
- The next short scene is generated from his perspective.

This is the MVP’s “wow” moment: a side character becomes the protagonist without resetting the story.

### Screen 5 — Time Machine

Display a simple branch graph:

```text
Opening
   |
Bridge confrontation
   |----------------------|
Trust Kael           Expose Kael
Timeline A           Timeline B
```

The user selects the unchosen decision and presses:

**Create alternate future**

The app:

1. Restores the snapshot before the decision.
2. Creates a second branch.
3. Applies the alternate event.
4. Shows the changed world state.
5. Generates a different continuation.
6. Preserves Timeline A for switching.

Only one fork is supported in the hackathon version.

---

## 5. Primary user journey

```text
Enter The Last Ember
→ Read the opening scene
→ Choose “Trust Kael”
→ See world state and memories change
→ Inspect Ravi’s memory
→ Continue the same story as Ravi
→ Open Time Machine
→ Change the decision to “Expose Kael”
→ See a consistent alternate future
→ Switch between Timeline A and Timeline B
```

Target demo duration: **3–4 minutes**.

---

## 6. Exact MVP scope

### Build

- One fixed universe
- Three fixed characters
- One opening scene
- One meaningful binary decision
- Two timeline branches
- Structured world-state updates
- Per-character memories and knowledge
- Protagonist switching to Ravi
- Two or three AI-generated scene continuations
- Timeline comparison
- Local persistence
- Polished responsive web interface
- Reset-demo button

### Simulate or precompute

- Character artwork
- The opening narration
- Fallback continuations
- Initial memories and world facts
- Comic panel backgrounds, if used

### Do not build

- Authentication
- Payments
- User-created universes
- Multiplayer or live voting
- AI Co-Author
- Dream to Story
- Audio generation
- Story Genome
- Personalized Villains
- Character Resurrection across universes
- Arbitrary timeline depth
- Branch merging
- General knowledge graph
- Production moderation system
- Image generation during the live demo
- Databricks in the synchronous request path
- Microservices

---

## 7. Product behavior

### Decision: Trust Kael

Committed event:

```json
{
  "type": "CHARACTER_DECISION",
  "actor": "mira",
  "action": "TRUST_KAEL",
  "location": "eastern_bridge",
  "branch": "timeline_a"
}
```

Effects:

- Kael’s trust in Mira: +25
- Ravi’s trust in Mira: -10
- City alert remains Elevated
- Kael is not arrested
- Mira gains memory: “I protected Kael at the bridge.”
- Ravi gains belief: “Mira may be hiding something.”

### Decision: Expose Kael

Committed event:

```json
{
  "type": "CHARACTER_DECISION",
  "actor": "mira",
  "action": "EXPOSE_KAEL",
  "location": "eastern_bridge",
  "branch": "timeline_b"
}
```

Effects:

- Kael’s trust in Mira: -30
- Ravi’s trust in Mira: +15
- City alert becomes Critical
- Kael is detained
- Mira gains memory: “I exposed Kael to Ravi.”
- Ravi gains memory: “Mira trusted me with the truth.”

These effects should be deterministic. The AI writes the scene around them; it does not decide or modify them.

---

## 8. Minimal technical architecture

Use a modular full-stack web application, not microservices.

```text
Next.js web app
   |
   |-- Story UI
   |-- Character UI
   |-- Timeline UI
   |
Server actions / API routes
   |
   |-- loadUniverse()
   |-- commitDecision()
   |-- switchProtagonist()
   |-- createBranch()
   |-- generateScene()
   |
Story engine
   |-- deterministic state reducer
   |-- context builder
   |-- LLM adapter
   |-- output validator
   |
Local SQLite / JSON persistence
```

### Recommended hackathon stack

- Next.js + TypeScript
- Tailwind CSS or plain CSS modules
- SQLite with Prisma, or a JSON file if setup time is tight
- One model API for structured scene generation
- Zod for validating generated JSON
- Local browser storage only for UI preferences
- Static image assets

Databricks is not necessary for the live MVP. Mention it in the architecture slide as the future analytics, evaluation, and Story Genome layer.

---

## 9. Minimal data model

### Universe

```ts
type Universe = {
  id: string;
  title: string;
  premise: string;
  rules: string[];
};
```

### Character

```ts
type Character = {
  id: string;
  name: string;
  role: string;
  personality: string[];
  goals: string[];
  secrets: string[];
};
```

### Character state

```ts
type CharacterState = {
  characterId: string;
  branchId: string;
  emotion: string;
  location: string;
  memories: Memory[];
  beliefs: Belief[];
  relationships: Record<string, number>;
};
```

### Canon event

```ts
type StoryEvent = {
  id: string;
  branchId: string;
  sequence: number;
  type: string;
  actorId: string;
  payload: Record<string, unknown>;
  causedBy?: string;
  createdAt: string;
};
```

### Branch

```ts
type Branch = {
  id: string;
  name: string;
  parentBranchId?: string;
  forkEventId?: string;
  selectedDecision: "TRUST_KAEL" | "EXPOSE_KAEL" | null;
};
```

### Scene

```ts
type Scene = {
  id: string;
  branchId: string;
  protagonistId: string;
  narration: string;
  dialogue: Array<{
    characterId: string;
    text: string;
  }>;
  sourceEventIds: string[];
};
```

---

## 10. Story-generation contract

The model receives:

- Fixed universe rules
- Current branch
- Current world-state projection
- Current protagonist’s personality
- Only the protagonist’s known facts and memories
- Recent committed events
- Required deterministic consequences

The model returns:

```json
{
  "title": "A short scene title",
  "narration": "120–180 words",
  "dialogue": [
    {
      "characterId": "ravi",
      "text": "Dialogue"
    }
  ],
  "closingHook": "One sentence"
}
```

The model is forbidden from:

- Reviving or killing a character
- Adding a new major character
- Changing world-state values
- Revealing secrets the protagonist does not know
- Creating additional branches
- Contradicting required consequences

Validate the response. If it fails, retry once and then use a prepared fallback scene.

---

## 11. API surface

Only five endpoints or server actions are needed:

```text
GET  /api/story
POST /api/decision
POST /api/protagonist
POST /api/branch
POST /api/reset
```

### `POST /api/decision`

Input:

```json
{
  "branchId": "timeline_a",
  "decision": "TRUST_KAEL"
}
```

Output:

```json
{
  "event": {},
  "worldChanges": [],
  "memoryChanges": [],
  "scene": {}
}
```

Make requests idempotent using a client-generated action ID so double-clicking does not commit the decision twice.

---

## 12. Visual design direction

### Style

**Cinematic storybook interface with a visible system beneath it.**

The product should feel magical, but the state changes should feel trustworthy and legible.

### Palette

- Background: midnight navy `#090D18`
- Surface: deep blue `#121A2B`
- Primary ember: amber `#F5A524`
- Alternate branch: violet `#8B5CF6`
- Text: warm ivory `#F5F1E8`
- Muted text: blue-grey `#9AA6B8`
- Danger: coral `#F06464`

### Typography

- Display: cinematic serif
- Interface/body: clean sans-serif
- State/event values: compact monospaced text where useful

### Signature visual motif

A glowing horizontal timeline runs through the experience:

- Amber represents the original timeline.
- Violet represents the alternate future.
- Small illuminated nodes represent committed events.

### Interaction details

- Choices illuminate on hover/focus.
- A committed decision sends a pulse through the timeline.
- Changed values briefly flash.
- New character memories receive a “Remembered” label.
- Switching protagonist changes the accent color and narration label.
- Branch creation visually splits the timeline.

Avoid a generic admin dashboard. The story remains the dominant element.

---

## 13. 15-hour execution plan

### Hour 0–1: Lock scope and seed content

- Finalize the universe, three characters, opening scene, and two decisions.
- Write deterministic consequences.
- Prepare fallback continuations.

### Hour 1–3: App shell and visual system

- Set up the project.
- Build the story-reader layout.
- Add responsive styling and character cards.

### Hour 3–5: State and event model

- Add seed data.
- Implement the event reducer.
- Implement branch-specific world and character projections.
- Add reset behavior.

### Hour 5–7: Core interaction

- Commit decision.
- Animate world-state changes.
- Update memories and relationships.
- Persist the current demo state.

### Hour 7–9: AI generation

- Build the context assembler.
- Add the structured generation call.
- Validate the response.
- Add timeout and fallback handling.

### Hour 9–11: Character switching

- Build the memory drawer.
- Add Ravi’s point-of-view continuation.
- Verify that he receives only his own knowledge.

### Hour 11–13: Time Machine

- Build the branch view.
- Restore the pre-choice snapshot.
- Create Timeline B.
- Compare and switch timelines.

### Hour 13–14: Demo resilience

- Test every demo path.
- Prevent duplicate decisions.
- Handle model errors.
- Ensure reset works.
- Check mobile and laptop layouts.

### Hour 14–15: Submission

- Deploy.
- Record a short backup video.
- Prepare the pitch and architecture slide.
- Freeze the code before the judging session.

### Time-saving rule

If running late, cut in this order:

1. Live AI generation—use prepared continuations.
2. Mobile polish.
3. Extra animation.
4. Comic styling.

Never cut persistent memories, protagonist switching, or the timeline fork. They are the product thesis.

---

## 14. Demo script

### Opening — 20 seconds

> Most AI story apps forget what happened. StoryVerse treats every decision as part of a living world. Every character remembers it, and any character can carry the story forward.

### Moment 1: Make a decision — 45 seconds

- Read the final lines of the opening.
- Choose **Trust Kael**.
- Show the world-state changes.
- Point out the committed event on the timeline.

> The AI did not invent these state changes. They were validated and committed first; the scene was generated around them.

### Moment 2: Inspect memory — 40 seconds

- Open Mira, Ravi, and Kael.
- Show that each has different knowledge and memories.

> This distinction between world truth and character belief is what keeps the story coherent.

### Moment 3: Promote a side character — 40 seconds

- Select Ravi.
- Click **Continue as Ravi**.
- Reveal his scene.

> Ravi was a side character seconds ago. Now he is the protagonist, with the same world history but only the knowledge he actually possesses.

### Moment 4: Change history — 60 seconds

- Open Time Machine.
- Fork at the bridge decision.
- Select **Expose Kael**.
- Show Timeline B and its different state.
- Switch between A and B.

> We regenerate the future on a new branch. The original history remains intact.

### Close — 20 seconds

> This small prototype is the continuity engine behind an infinite story universe. Audio drama, collaborative authorship, character resurrection, and personalized narratives can all plug into the same event and memory model.

---

## 15. Hackathon pitch

### Problem

AI can generate endless content, but generated stories usually forget facts, flatten characters, and lose coherence when users make choices.

### Insight

The story should not be the database. A structured world, an immutable event history, and character-specific memory should be the database. Narrative is generated from that truth.

### Solution

StoryVerse turns every user decision into a validated event, updates each character’s memory, and lets users explore alternate futures or promote any character into the protagonist.

### Innovation

- Persistent character-specific memory
- Truth separated from character belief
- Event-sourced branching timelines
- Protagonist switching without continuity loss

### Expansion

The same foundation supports collaborative stories, Dream to Story, Story Genome, Character Resurrection, and safe personalization.

---

## 16. Judging criteria to optimize for

### Innovation

Emphasize the separation of:

- Canonical truth
- Character beliefs
- Generated narration

### Technical depth

Show:

- The event payload
- Deterministic state changes
- The per-character context
- The branch graph

Do not spend the whole demo showing UI.

### Impact

Position the platform for:

- Interactive fiction
- Games
- Comics and audio
- Education and historical simulations
- Community-created universes

### Completeness

A narrow, reliable loop will score better than seven menu items labeled “coming soon.”

---

## 17. Submission checklist

- [ ] One-click demo reset
- [ ] No authentication required
- [ ] Seed universe loads instantly
- [ ] Both decisions work
- [ ] State and memories visibly change
- [ ] Ravi can become protagonist
- [ ] Alternate branch can be created
- [ ] Original branch remains accessible
- [ ] Generation has timeout and fallback
- [ ] No secrets appear in the wrong character’s context
- [ ] Responsive at the presentation resolution
- [ ] Deployed URL tested in a private window
- [ ] Three-minute backup video recorded
- [ ] Architecture diagram included in submission
- [ ] README explains setup and product thesis

---

## 18. Definition of done

The MVP is done when a judge can:

1. Enter the fixed universe.
2. Make one decision.
3. See that the world and characters remember it.
4. Continue the same continuity as Ravi.
5. Change the original decision.
6. Observe a second, internally consistent timeline.
7. Reset the demo without developer assistance.

Anything that does not improve this seven-step journey is outside the 15-hour scope.
