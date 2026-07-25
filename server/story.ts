import type { World } from "./worlds.js";
import { logWarn } from "./logger.js";
import { extractOutputText, responseDiagnostics, type OpenAIResponsePayload } from "./openai-response.js";
import { collectResponseOutputText, NarrationJsonDeltaDecoder } from "./story-stream.js";

export type StoryCharacter = {
  id: string;
  name: string;
  role: string;
  visualDescription: string;
  personality: string;
  goal: string;
  memories: string[];
  /** Canonical chapter that made this persistent character part of the cast. */
  introducedInChapter?: string;
};

export type StoryBeat = { id: string; description: string; caption: string };
export type StoryAudioDirection = { primaryEmotion: "reflection" | "suspense" | "danger" | "conflict" | "grief" | "triumph"; secondaryEmotion: "reflection" | "suspense" | "danger" | "conflict" | "grief" | "triumph"; intensity: number; bgmCue: "reflection" | "suspense" | "danger" | "conflict" | "grief" | "triumph"; narrationDelivery: string };
export type StoryChapter = { id: string; number: number; title: string; narration: string; beats: StoryBeat[]; audioDirection?: StoryAudioDirection; command?: string; /** Starts at 1; later revisions receive unique visual/audio identities. */ revision?: number };
export type Perspective = { characterId: string; chapterId: string; narration: string; beats: StoryBeat[] };
export type WorldStory = {
  worldId: string;
  characters: StoryCharacter[];
  chapters: StoryChapter[];
  perspectives: Perspective[];
  worldState: string;
  source: "openai" | "fallback";
  createdAt: string;
  updatedAt: string;
  /** Optional in types while old stored stories are upgraded on read. */
  upcomingDirections?: string[];
};

export type NextChapterGeneration = { chapter: StoryChapter; newCharacters: StoryCharacter[] };
export type ChapterRevisionGeneration = { chapter: StoryChapter; newCharacters: StoryCharacter[] };

/** Prevent a long-lived draft queue from inflating the next model context. */
export const MAX_UPCOMING_DIRECTIONS = 12;

export type StoryStreamCallbacks = {
  /** Decoded prose from the `narration` JSON field only. */
  onNarration?: (text: string) => void;
  /** The provider stream has ended and full JSON validation is beginning. */
  onPhase?: (stage: "validating") => void;
};

type InitialShape = { characters: StoryCharacter[]; chapter: StoryChapter; worldState: string };

const schema = {
  type: "object", additionalProperties: false, required: ["characters", "chapter", "worldState"], properties: {
    worldState: { type: "string", minLength: 30, maxLength: 600 },
    characters: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false, required: ["id", "name", "role", "visualDescription", "personality", "goal", "memories"], properties: { id: { type: "string", minLength: 1, maxLength: 128 }, name: { type: "string", minLength: 1, maxLength: 160 }, role: { type: "string", minLength: 1, maxLength: 240 }, visualDescription: { type: "string", minLength: 1, maxLength: 1200 }, personality: { type: "string", minLength: 1, maxLength: 800 }, goal: { type: "string", minLength: 1, maxLength: 800 }, memories: { type: "array", items: { type: "string", minLength: 1, maxLength: 1200 } } } } },
    chapter: { type: "object", additionalProperties: false, required: ["id", "number", "title", "narration", "beats", "audioDirection"], properties: { id: { type: "string" }, number: { type: "integer" }, title: { type: "string" }, narration: { type: "string", minLength: 350, maxLength: 2400 }, beats: { type: "array", minItems: 3, maxItems: 4, items: { type: "object", additionalProperties: false, required: ["id", "description", "caption"], properties: { id: { type: "string" }, description: { type: "string" }, caption: { type: "string" } } } }, audioDirection: { type: "object", additionalProperties: false, required: ["primaryEmotion", "secondaryEmotion", "intensity", "bgmCue", "narrationDelivery"], properties: { primaryEmotion: { type: "string", enum: ["reflection", "suspense", "danger", "conflict", "grief", "triumph"] }, secondaryEmotion: { type: "string", enum: ["reflection", "suspense", "danger", "conflict", "grief", "triumph"] }, intensity: { type: "number", minimum: 0, maximum: 1 }, bgmCue: { type: "string", enum: ["reflection", "suspense", "danger", "conflict", "grief", "triumph"] }, narrationDelivery: { type: "string", minLength: 3, maxLength: 100 } } } } },
  },
};

const canonicalChapterSchema = {
  type: "object", additionalProperties: false,
  required: ["id", "number", "title", "narration", "beats", "audioDirection"],
  properties: schema.properties.chapter.properties,
};

const nextChapterSchema = {
  type: "object", additionalProperties: false,
  required: ["id", "number", "title", "narration", "beats", "audioDirection", "newCharacters"],
  properties: {
    ...schema.properties.chapter.properties,
    newCharacters: { type: "array", minItems: 0, items: schema.properties.characters.items },
  },
};

const revisionChapterSchema = {
  type: "object", additionalProperties: false,
  required: ["id", "number", "title", "narration", "beats", "audioDirection", "newCharacters"],
  properties: {
    ...canonicalChapterSchema.properties,
    newCharacters: { type: "array", minItems: 0, items: schema.properties.characters.items },
  },
};

function cleanId(value: string, fallback: string): string { return value.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || fallback; }
function now(): string { return new Date().toISOString(); }
const emotionValues = ["reflection", "suspense", "danger", "conflict", "grief", "triumph"] as const;
function fallbackAudioDirection(text: string): StoryAudioDirection {
  const value = text.toLowerCase(); const primaryEmotion = /death|dies|dead|grief|mourn|funeral|loss/.test(value) ? "grief" : /triumph|victory|hope|dawn|celebrat|reunite/.test(value) ? "triumph" : /battle|war|attack|siege|fight|blade|army|chase/.test(value) ? "conflict" : /thunder|storm|lightning|tempest|danger|blood|fire|threat/.test(value) ? "danger" : /secret|hidden|mystery|suspicion|unknown|shadow|door|omen/.test(value) ? "suspense" : "reflection";
  return { primaryEmotion, secondaryEmotion: "reflection", intensity: primaryEmotion === "reflection" ? 0.35 : 0.7, bgmCue: primaryEmotion, narrationDelivery: primaryEmotion === "conflict" ? "immediate and urgent" : primaryEmotion === "grief" ? "quiet and intimate" : "cinematic and attentive" };
}
function normalizeAudioDirection(value: unknown, text: string): StoryAudioDirection {
  if (!value || typeof value !== "object") return fallbackAudioDirection(text);
  const direction = value as Partial<StoryAudioDirection>;
  if (!emotionValues.includes(direction.primaryEmotion as StoryAudioDirection["primaryEmotion"]) || !emotionValues.includes(direction.secondaryEmotion as StoryAudioDirection["secondaryEmotion"]) || !emotionValues.includes(direction.bgmCue as StoryAudioDirection["bgmCue"]) || typeof direction.intensity !== "number" || direction.intensity < 0 || direction.intensity > 1 || typeof direction.narrationDelivery !== "string") return fallbackAudioDirection(text);
  return { primaryEmotion: direction.primaryEmotion as StoryAudioDirection["primaryEmotion"], secondaryEmotion: direction.secondaryEmotion as StoryAudioDirection["secondaryEmotion"], intensity: direction.intensity, bgmCue: direction.bgmCue as StoryAudioDirection["bgmCue"], narrationDelivery: direction.narrationDelivery.slice(0, 100) };
}

function normalizedRevision(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : 1;
}

function normalizedDirections(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const directions: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const direction = entry.trim().replace(/\s+/g, " ");
    if (direction.length < 3 || direction.length > 1000) continue;
    const identity = direction.toLocaleLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    directions.push(direction);
  }
  return directions.slice(0, MAX_UPCOMING_DIRECTIONS);
}

/**
 * A model response is never partially accepted: one malformed or duplicate
 * character invalidates the response, which prevents an author-requested cast
 * from being silently shortened on its way to persistence.
 */
function normalizeAdditionalCharacters(value: unknown, existing: StoryCharacter[]): StoryCharacter[] | null {
  if (!Array.isArray(value)) return null;
  const identities = new Set(existing.flatMap((character) => [`id:${character.id.toLocaleLowerCase()}`, `name:${character.name.toLocaleLowerCase()}`]));
  const additions: StoryCharacter[] = [];
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== "object") return null;
    const candidate = raw as Partial<StoryCharacter>;
    if (![candidate.id, candidate.name, candidate.role, candidate.visualDescription, candidate.personality, candidate.goal].every((field) => typeof field === "string" && field.trim().length > 0)) return null;
    if (!Array.isArray(candidate.memories) || !candidate.memories.every((memory) => typeof memory === "string" && memory.trim().length > 0)) return null;
    const name = candidate.name!.trim();
    const id = cleanId(candidate.id!, `character-${existing.length + index + 1}`);
    const identity = [`id:${id.toLocaleLowerCase()}`, `name:${name.toLocaleLowerCase()}`];
    if (identity.some((entry) => identities.has(entry))) return null;
    const memories = candidate.memories.map((memory) => memory.trim());
    additions.push({ id, name, role: candidate.role!.trim(), visualDescription: candidate.visualDescription!.trim(), personality: candidate.personality!.trim(), goal: candidate.goal!.trim(), memories });
    identity.forEach((entry) => identities.add(entry));
  }
  return additions;
}

function tagCharacterOrigins(characters: StoryCharacter[], chapterId: string): StoryCharacter[] {
  return characters.map((character) => ({ ...character, introducedInChapter: chapterId }));
}

/** Provider beat labels repeat frequently (for example, `beat_01`). IDs are
 * canonical scene identities, so every chapter owns a distinct image cache. */
function normalizeChapter(payload: StoryChapter, number: number, command?: string, revision = 1): StoryChapter {
  const id = `chapter-${number}`;
  const normalized = normalizedRevision(revision);
  const beatPrefix = normalized > 1 ? `${id}-r${normalized}` : id;
  return {
    id,
    number,
    title: payload.title,
    narration: payload.narration,
    revision: normalized,
    ...(command ? { command } : {}),
    audioDirection: normalizeAudioDirection(payload.audioDirection, `${payload.title}\n${payload.narration}`),
    beats: payload.beats.map((beat, index) => ({ ...beat, id: `${beatPrefix}-beat-${index + 1}` })),
  };
}

function perspectiveBeatPrefix(chapter: StoryChapter, characterId: string): string {
  const revision = normalizedRevision(chapter.revision);
  return revision > 1 ? `${chapter.id}-r${revision}-${characterId}` : `${chapter.id}-${characterId}`;
}

function emptyStory(worldId: string): WorldStory {
  const time = now();
  return { worldId, characters: [], chapters: [], perspectives: [], upcomingDirections: [], worldState: "This world awaits its first generated chapter.", source: "fallback", createdAt: time, updatedAt: time };
}

async function modelJson<T>(instructions: string, input: string, responseSchema: object): Promise<T | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    logWarn("story.generation.unavailable", { reason: "missing_api_key" });
    return null;
  }
  try {
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4.1-mini", instructions, input, text: { format: { type: "json_schema", name: "story_payload", strict: true, schema: responseSchema } } }) });
    if (!response.ok) {
      logWarn("story.generation.provider_error", { status: response.status });
      return null;
    }
    const result = await response.json() as OpenAIResponsePayload;
    const outputText = extractOutputText(result);
    if (!outputText) {
      logWarn("story.generation.invalid_response", { reason: "missing_output_text", ...responseDiagnostics(result) });
      return null;
    }
    try { return JSON.parse(outputText) as T; }
    catch { logWarn("story.generation.invalid_response", { reason: "invalid_json" }); return null; }
  } catch (error) {
    logWarn("story.generation.request_error", { reason: error instanceof Error ? error.name : "unknown" });
    return null;
  }
}

/**
 * Uses the same strict structured-output request as `modelJson`, but consumes
 * the Responses API SSE stream. Raw JSON is kept server-side; only decoded
 * `narration` fragments are forwarded through the callback.
 */
async function modelJsonStream<T>(
  instructions: string,
  input: string,
  responseSchema: object,
  callbacks: StoryStreamCallbacks,
): Promise<T | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    logWarn("story.generation.unavailable", { reason: "missing_api_key" });
    return null;
  }
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        instructions,
        input,
        stream: true,
        text: { format: { type: "json_schema", name: "story_payload", strict: true, schema: responseSchema } },
      }),
    });
    if (!response.ok || !response.body) {
      logWarn("story.generation.provider_error", { status: response.status });
      return null;
    }
    const narrationDecoder = new NarrationJsonDeltaDecoder();
    const streamed = await collectResponseOutputText(response.body, (rawDelta) => {
      const narration = narrationDecoder.push(rawDelta);
      if (narration) callbacks.onNarration?.(narration);
    });
    if (!streamed.ok) {
      logWarn("story.generation.stream_error", { reason: streamed.reason });
      return null;
    }
    callbacks.onPhase?.("validating");
    try {
      return JSON.parse(streamed.outputText) as T;
    } catch {
      logWarn("story.generation.invalid_response", { reason: "invalid_json" });
      return null;
    }
  } catch (error) {
    logWarn("story.generation.request_error", { reason: error instanceof Error ? error.name : "unknown" });
    return null;
  }
}

const originalGuard = "Create original characters and an original plot. A user-supplied title or genre may evoke an existing work, but never reuse protected named characters, dialogue, plot events, costumes, or scenes from it. Do not include real-world celebrity likenesses.";

export async function generateInitialStory(world: World): Promise<WorldStory> {
  const payload = await modelJson<InitialShape>(
    `You are StoryVerse's long-form fiction engine. ${originalGuard} Write a cinematic, anime-inspired but culturally respectful chapter. Make the cast visually distinct and keep their visual descriptions stable across future chapters. Set audioDirection from the chapter's actual emotional context: select the primary and secondary emotion, intensity 0–1, local BGM cue, and a concise narration delivery. No markdown.`,
    `World title: ${world.title}\nGenre: ${world.genre}\nCore premise: ${world.premise}\nCreative direction: ${world.creatorPrompt}\nWrite Chapter 1 and an original persistent cast appropriate to this world. The cast has no fixed size: include every character the opening genuinely needs, and make each one fully specified for later point-of-view chapters.`, schema,
  );
  if (!payload || !Array.isArray(payload.characters) || !payload.chapter?.narration || !Array.isArray(payload.chapter.beats)) return emptyStory(world.id);
  const time = now();
  const characters = normalizeAdditionalCharacters(payload.characters, []);
  if (!characters || characters.length === 0) return emptyStory(world.id);
  const chapter = normalizeChapter(payload.chapter, 1);
  return { worldId: world.id, characters: tagCharacterOrigins(characters, chapter.id), chapters: [chapter], perspectives: [], upcomingDirections: [], worldState: payload.worldState, source: "openai", createdAt: time, updatedAt: time };
}

type NextChapterPayload = StoryChapter & { newCharacters?: unknown };

function nextChapterRequest(world: World, story: WorldStory, command?: string): { previous: StoryChapter; directions: string[]; instructions: string; input: string } | null {
  const previous = story.chapters.at(-1);
  if (!previous || story.characters.length === 0) return null;
  const directions = normalizedDirections(story.upcomingDirections);
  return {
    previous,
    directions,
    instructions: `You continue an original StoryVerse serial. ${originalGuard} Preserve every existing character's visual description, personality, goal, and memories. Advance exactly one chapter with three to four imageable beats. Set audioDirection from the new chapter's actual emotional context: select the primary and secondary emotion, intensity 0–1, local BGM cue, and a concise narration delivery. Return newCharacters as an array of fully specified characters. There is no fixed maximum cast size: a queued direction may introduce any number of new characters when the story requires it. Add a new character only when the queued directions clearly justify it; otherwise return an empty array. If a queued direction requests named or new characters, introduce every requested character in the chapter prose and include a complete matching entry in newCharacters; never merely mention an unpersisted new character.`,
    input: `World: ${world.title}\nPremise: ${world.premise}\nWorld state: ${story.worldState}\nPersistent characters: ${JSON.stringify(story.characters)}\nPrevious chapter: ${previous.narration}\nQueued directions for this chapter: ${JSON.stringify(directions)}\nAuthor command: ${command ?? "Continue the central conflict naturally."}\nUse queued directions as story guidance, never print them as instructions. Write chapter ${previous.number + 1}.`,
  };
}

function normalizeNextChapter(payload: NextChapterPayload, story: WorldStory, previous: StoryChapter, directions: string[], command?: string): NextChapterGeneration | null {
  if (!payload?.narration || !Array.isArray(payload.beats)) return null;
  const chapter = normalizeChapter(payload, previous.number + 1, command, 1);
  const newCharacters = normalizeAdditionalCharacters(payload.newCharacters ?? [], story.characters);
  if (!newCharacters) return null;
  // New cast members are permitted only as part of fulfilling a pending
  // direction; reject an unexpected expansion instead of silently dropping it.
  if (directions.length === 0 && newCharacters.length > 0) return null;
  return { chapter, newCharacters: tagCharacterOrigins(newCharacters, chapter.id) };
}

export async function generateNextChapter(world: World, story: WorldStory, command?: string): Promise<NextChapterGeneration | null> {
  const request = nextChapterRequest(world, story, command);
  if (!request) return null;
  const payload = await modelJson<NextChapterPayload>(request.instructions, request.input, nextChapterSchema);
  return payload ? normalizeNextChapter(payload, story, request.previous, request.directions, command) : null;
}

/** Stream a next chapter while keeping raw structured JSON on the server. */
export async function generateNextChapterStream(
  world: World,
  story: WorldStory,
  callbacks: StoryStreamCallbacks,
  command?: string,
): Promise<NextChapterGeneration | null> {
  const request = nextChapterRequest(world, story, command);
  if (!request) return null;
  const payload = await modelJsonStream<NextChapterPayload>(request.instructions, request.input, nextChapterSchema, callbacks);
  return payload ? normalizeNextChapter(payload, story, request.previous, request.directions, command) : null;
}

function revisionRequest(world: World, story: WorldStory, prompt: string): { current: StoryChapter; revision: number; instructions: string; input: string } | null {
  const current = story.chapters.at(-1);
  if (!current || story.characters.length === 0) return null;
  const revision = normalizedRevision(current.revision) + 1;
  return {
    current,
    revision,
    instructions: `You revise the latest canonical chapter of an original StoryVerse serial. ${originalGuard} Preserve every existing persistent character, including their visual descriptions, personalities, goals, memories, and established world continuity. Apply the revision request to this chapter only. If and only if the revision explicitly introduces new characters, introduce each one in the prose and return every one as a complete entry in newCharacters; there is no fixed maximum. Do not remove existing persistent characters or expose instructions in the prose. Return a replacement chapter with three to four imageable beats and audioDirection.`,
    input: `World: ${world.title}\nPremise: ${world.premise}\nWorld state: ${story.worldState}\nPersistent characters: ${JSON.stringify(story.characters)}\nQueued future directions (do not consume them): ${JSON.stringify(normalizedDirections(story.upcomingDirections))}\nCurrent canonical chapter: ${JSON.stringify(current)}\nRevision request: ${prompt}\nRewrite chapter ${current.number} in place.`,
  };
}

/** Rewrite only the latest canonical chapter; callers persist the replacement atomically. */
export async function reviseLatestChapter(world: World, story: WorldStory, prompt: string): Promise<ChapterRevisionGeneration | null> {
  const request = revisionRequest(world, story, prompt);
  if (!request) return null;
  const payload = await modelJson<NextChapterPayload>(request.instructions, request.input, revisionChapterSchema);
  if (!payload?.narration || !Array.isArray(payload.beats)) return null;
  const newCharacters = normalizeAdditionalCharacters(payload.newCharacters ?? [], story.characters);
  if (!newCharacters) return null;
  const chapter = normalizeChapter(payload, request.current.number, request.current.command, request.revision);
  return { chapter, newCharacters: tagCharacterOrigins(newCharacters, chapter.id) };
}

/** Stream a revision while keeping raw structured JSON on the server. */
export async function reviseLatestChapterStream(
  world: World,
  story: WorldStory,
  prompt: string,
  callbacks: StoryStreamCallbacks,
): Promise<ChapterRevisionGeneration | null> {
  const request = revisionRequest(world, story, prompt);
  if (!request) return null;
  const payload = await modelJsonStream<NextChapterPayload>(request.instructions, request.input, revisionChapterSchema, callbacks);
  if (!payload?.narration || !Array.isArray(payload.beats)) return null;
  const newCharacters = normalizeAdditionalCharacters(payload.newCharacters ?? [], story.characters);
  if (!newCharacters) return null;
  const chapter = normalizeChapter(payload, request.current.number, request.current.command, request.revision);
  return { chapter, newCharacters: tagCharacterOrigins(newCharacters, chapter.id) };
}

export async function generatePerspective(world: World, story: WorldStory, characterId: string): Promise<Perspective | null> {
  const character = story.characters.find((candidate) => candidate.id === characterId);
  const chapter = story.chapters.at(-1);
  if (!character || !chapter) return null;
  const perspectiveSchema = { type: "object", additionalProperties: false, required: ["narration", "beats"], properties: { narration: { type: "string", minLength: 280, maxLength: 2200 }, beats: schema.properties.chapter.properties.beats } };
  const payload = await modelJson<{ narration: string; beats: StoryBeat[] }>(
    `You write an original character point-of-view retelling. ${originalGuard} Use only the selected character's stated memories, personality, goal, and observations. Never invent hidden knowledge from other characters.`,
    `World: ${world.title}\nSelected character: ${JSON.stringify(character)}\nCurrent chapter: ${chapter.narration}\nReturn a close POV retelling and 3–4 imageable beats.`, perspectiveSchema,
  );
  if (!payload?.narration || !Array.isArray(payload.beats)) return null;
  const beatPrefix = perspectiveBeatPrefix(chapter, characterId);
  return { characterId, chapterId: chapter.id, narration: payload.narration, beats: payload.beats.map((beat, index) => ({ ...beat, id: `${beatPrefix}-beat-${index + 1}` })) };
}

/** Stream an isolated character perspective after the whole payload validates. */
export async function generatePerspectiveStream(
  world: World,
  story: WorldStory,
  characterId: string,
  callbacks: StoryStreamCallbacks,
): Promise<Perspective | null> {
  const character = story.characters.find((candidate) => candidate.id === characterId);
  const chapter = story.chapters.at(-1);
  if (!character || !chapter) return null;
  const perspectiveSchema = { type: "object", additionalProperties: false, required: ["narration", "beats"], properties: { narration: { type: "string", minLength: 280, maxLength: 2200 }, beats: schema.properties.chapter.properties.beats } };
  const payload = await modelJsonStream<{ narration: string; beats: StoryBeat[] }>(
    `You write an original character point-of-view retelling. ${originalGuard} Use only the selected character's stated memories, personality, goal, and observations. Never invent hidden knowledge from other characters.`,
    `World: ${world.title}\nSelected character: ${JSON.stringify(character)}\nCurrent chapter: ${chapter.narration}\nReturn a close POV retelling and 3–4 imageable beats.`, perspectiveSchema,
    callbacks,
  );
  if (!payload?.narration || !Array.isArray(payload.beats)) return null;
  const beatPrefix = perspectiveBeatPrefix(chapter, characterId);
  return { characterId, chapterId: chapter.id, narration: payload.narration, beats: payload.beats.map((beat, index) => ({ ...beat, id: `${beatPrefix}-beat-${index + 1}` })) };
}
