import type { World } from "./worlds.js";
import { logWarn } from "./logger.js";
import { extractOutputText, responseDiagnostics, type OpenAIResponsePayload } from "./openai-response.js";

export type StoryCharacter = {
  id: string;
  name: string;
  role: string;
  visualDescription: string;
  personality: string;
  goal: string;
  memories: string[];
};

export type StoryBeat = { id: string; description: string; caption: string };
export type StoryAudioDirection = { primaryEmotion: "reflection" | "suspense" | "danger" | "conflict" | "grief" | "triumph"; secondaryEmotion: "reflection" | "suspense" | "danger" | "conflict" | "grief" | "triumph"; intensity: number; bgmCue: "reflection" | "suspense" | "danger" | "conflict" | "grief" | "triumph"; narrationDelivery: string };
export type StoryChapter = { id: string; number: number; title: string; narration: string; beats: StoryBeat[]; audioDirection?: StoryAudioDirection; command?: string };
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
};

type InitialShape = { characters: StoryCharacter[]; chapter: StoryChapter; worldState: string };

const schema = {
  type: "object", additionalProperties: false, required: ["characters", "chapter", "worldState"], properties: {
    worldState: { type: "string", minLength: 30, maxLength: 600 },
    characters: { type: "array", minItems: 3, maxItems: 4, items: { type: "object", additionalProperties: false, required: ["id", "name", "role", "visualDescription", "personality", "goal", "memories"], properties: { id: { type: "string" }, name: { type: "string" }, role: { type: "string" }, visualDescription: { type: "string" }, personality: { type: "string" }, goal: { type: "string" }, memories: { type: "array", items: { type: "string" }, maxItems: 3 } } } },
    chapter: { type: "object", additionalProperties: false, required: ["id", "number", "title", "narration", "beats", "audioDirection"], properties: { id: { type: "string" }, number: { type: "integer" }, title: { type: "string" }, narration: { type: "string", minLength: 350, maxLength: 2400 }, beats: { type: "array", minItems: 3, maxItems: 4, items: { type: "object", additionalProperties: false, required: ["id", "description", "caption"], properties: { id: { type: "string" }, description: { type: "string" }, caption: { type: "string" } } } }, audioDirection: { type: "object", additionalProperties: false, required: ["primaryEmotion", "secondaryEmotion", "intensity", "bgmCue", "narrationDelivery"], properties: { primaryEmotion: { type: "string", enum: ["reflection", "suspense", "danger", "conflict", "grief", "triumph"] }, secondaryEmotion: { type: "string", enum: ["reflection", "suspense", "danger", "conflict", "grief", "triumph"] }, intensity: { type: "number", minimum: 0, maximum: 1 }, bgmCue: { type: "string", enum: ["reflection", "suspense", "danger", "conflict", "grief", "triumph"] }, narrationDelivery: { type: "string", minLength: 3, maxLength: 100 } } } } },
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

/** Provider beat labels repeat frequently (for example, `beat_01`). IDs are
 * canonical scene identities, so every chapter owns a distinct image cache. */
function normalizeChapter(payload: StoryChapter, number: number, command?: string): StoryChapter {
  const id = `chapter-${number}`;
  return {
    ...payload,
    id,
    number,
    command,
    audioDirection: normalizeAudioDirection(payload.audioDirection, `${payload.title}\n${payload.narration}`),
    beats: payload.beats.map((beat, index) => ({ ...beat, id: `${id}-beat-${index + 1}` })),
  };
}

function emptyStory(worldId: string): WorldStory {
  const time = now();
  return { worldId, characters: [], chapters: [], perspectives: [], worldState: "This world awaits its first generated chapter.", source: "fallback", createdAt: time, updatedAt: time };
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

const originalGuard = "Create original characters and an original plot. A user-supplied title or genre may evoke an existing work, but never reuse protected named characters, dialogue, plot events, costumes, or scenes from it. Do not include real-world celebrity likenesses.";

export async function generateInitialStory(world: World): Promise<WorldStory> {
  const payload = await modelJson<InitialShape>(
    `You are StoryVerse's long-form fiction engine. ${originalGuard} Write a cinematic, anime-inspired but culturally respectful chapter. Make the cast visually distinct and keep their visual descriptions stable across future chapters. Set audioDirection from the chapter's actual emotional context: select the primary and secondary emotion, intensity 0–1, local BGM cue, and a concise narration delivery. No markdown.`,
    `World title: ${world.title}\nGenre: ${world.genre}\nCore premise: ${world.premise}\nCreative direction: ${world.creatorPrompt}\nWrite Chapter 1 and exactly 3–4 original persistent characters.`, schema,
  );
  if (!payload || !Array.isArray(payload.characters) || !payload.chapter?.narration || !Array.isArray(payload.chapter.beats)) return emptyStory(world.id);
  const time = now();
  const characters = payload.characters.map((character, index) => ({ ...character, id: cleanId(character.id || character.name, `character-${index + 1}`), memories: Array.isArray(character.memories) ? character.memories.slice(0, 3) : [] }));
  const chapter = normalizeChapter(payload.chapter, 1);
  return { worldId: world.id, characters, chapters: [chapter], perspectives: [], worldState: payload.worldState, source: "openai", createdAt: time, updatedAt: time };
}

export async function generateNextChapter(world: World, story: WorldStory, command?: string): Promise<StoryChapter | null> {
  const previous = story.chapters.at(-1);
  if (!previous || story.characters.length === 0) return null;
  const chapterSchema = { type: "object", additionalProperties: false, required: ["id", "number", "title", "narration", "beats"], properties: schema.properties.chapter.properties };
  const payload = await modelJson<StoryChapter>(
    `You continue an original StoryVerse serial. ${originalGuard} Preserve every character's visual description, personality, goal, and memories. Advance exactly one chapter with three to four imageable beats. Set audioDirection from the new chapter's actual emotional context: select the primary and secondary emotion, intensity 0–1, local BGM cue, and a concise narration delivery.`,
    `World: ${world.title}\nPremise: ${world.premise}\nWorld state: ${story.worldState}\nCharacters: ${JSON.stringify(story.characters)}\nPrevious chapter: ${previous.narration}\nAuthor command: ${command ?? "Continue the central conflict naturally."}\nWrite chapter ${previous.number + 1}.`, chapterSchema,
  );
  if (!payload?.narration || !Array.isArray(payload.beats)) return null;
  return normalizeChapter(payload, previous.number + 1, command);
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
  return { characterId, chapterId: chapter.id, narration: payload.narration, beats: payload.beats.map((beat, index) => ({ ...beat, id: `${chapter.id}-${characterId}-beat-${index + 1}` })) };
}
