import type { World } from "./worlds.js";
import { logWarn } from "./logger.js";
import { extractOutputText, responseDiagnostics, type OpenAIResponsePayload } from "./openai-response.js";
import { collectResponseOutputText, NarrationJsonDeltaDecoder, readProviderSse } from "./story-stream.js";

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
/**
 * Compact continuity contract between adjacent canonical chapters. It is
 * intentionally chapter-local: it describes what this chapter settled, the
 * final image it earned, and only the immediate pressure carried forward.
 */
export type ChapterTransition = { resolvedBeat: string; closingImage: string; nextChapterHook: string; carryForward: string[] };
export type StoryChapter = { id: string; number: number; title: string; narration: string; beats: StoryBeat[]; audioDirection?: StoryAudioDirection; /** Optional while legacy saved chapters are read without migration. */ transition?: ChapterTransition; command?: string; /** Starts at 1; later revisions receive unique visual/audio identities. */ revision?: number };
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
  /** Incremented by PostgreSQL-backed persistence to reject stale concurrent writes. */
  version?: number;
};

export type NextChapterGeneration = { chapter: StoryChapter; newCharacters: StoryCharacter[] };

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
    chapter: { type: "object", additionalProperties: false, required: ["id", "number", "title", "narration", "beats", "audioDirection", "transition"], properties: { id: { type: "string" }, number: { type: "integer" }, title: { type: "string" }, narration: { type: "string", minLength: 350 }, beats: { type: "array", minItems: 3, maxItems: 4, items: { type: "object", additionalProperties: false, required: ["id", "description", "caption"], properties: { id: { type: "string" }, description: { type: "string" }, caption: { type: "string" } } } }, audioDirection: { type: "object", additionalProperties: false, required: ["primaryEmotion", "secondaryEmotion", "intensity", "bgmCue", "narrationDelivery"], properties: { primaryEmotion: { type: "string", enum: ["reflection", "suspense", "danger", "conflict", "grief", "triumph"] }, secondaryEmotion: { type: "string", enum: ["reflection", "suspense", "danger", "conflict", "grief", "triumph"] }, intensity: { type: "number", minimum: 0, maximum: 1 }, bgmCue: { type: "string", enum: ["reflection", "suspense", "danger", "conflict", "grief", "triumph"] }, narrationDelivery: { type: "string", minLength: 3, maxLength: 100 } } }, transition: { type: "object", additionalProperties: false, required: ["resolvedBeat", "closingImage", "nextChapterHook", "carryForward"], properties: { resolvedBeat: { type: "string", minLength: 8, maxLength: 420 }, closingImage: { type: "string", minLength: 8, maxLength: 420 }, nextChapterHook: { type: "string", minLength: 8, maxLength: 420 }, carryForward: { type: "array", minItems: 1, maxItems: 4, items: { type: "string", minLength: 8, maxLength: 420 } } } } } },
  },
};

const nextChapterSchema = {
  type: "object", additionalProperties: false,
  required: ["id", "number", "title", "narration", "beats", "audioDirection", "transition", "newCharacters"],
  properties: {
    ...schema.properties.chapter.properties,
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

function compactTransitionText(value: unknown, maximum = 240): string {
  if (typeof value !== "string") return "the chapter's unresolved consequence";
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "the chapter's unresolved consequence";
  return compact.length > maximum ? `${compact.slice(0, maximum - 1).trimEnd()}…` : compact;
}

/** Safe diagnostics: only field shape/count metadata, never generated prose. */
type CanonicalValidationDiagnostics = {
  reason?: string;
  narrationLength?: number;
  beatCount?: number;
  transitionPresent?: boolean;
  transitionKind?: string;
  carryForwardCount?: number;
  newCharacterCount?: number;
  directionCount?: number;
};

function noteValidation(diagnostics: CanonicalValidationDiagnostics | undefined, reason: string, details: Omit<CanonicalValidationDiagnostics, "reason"> = {}): void {
  if (!diagnostics || diagnostics.reason) return;
  diagnostics.reason = reason;
  Object.assign(diagnostics, details);
}

function transitionKind(value: unknown): string {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Old stored chapters have no transition. Derive one only as compact context
 * for their immediate successor; newly generated chapters persist a model
 * transition instead of retroactively mutating legacy records.
 */
function fallbackChapterTransition(chapter: Pick<StoryChapter, "narration" | "beats">): ChapterTransition {
  const opening = compactTransitionText(chapter.beats[0]?.description ?? chapter.narration);
  const closing = compactTransitionText(chapter.beats.at(-1)?.description ?? chapter.narration);
  const carryForward = compactTransitionText(chapter.beats.at(-1)?.caption ?? closing, 160);
  return {
    resolvedBeat: `The chapter brings its immediate pressure to a decision: ${opening}`,
    closingImage: `The chapter closes on ${closing}`,
    nextChapterHook: `What consequence follows from ${carryForward}?`,
    carryForward: [`Carry forward the immediate consequence of ${carryForward}.`],
  };
}

/** Provider responses must supply all four transition fields and nothing else. */
function normalizeChapterTransition(value: unknown, diagnostics?: CanonicalValidationDiagnostics): ChapterTransition | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    noteValidation(diagnostics, "invalid_transition_shape", { transitionPresent: value !== undefined, transitionKind: transitionKind(value) });
    return null;
  }
  const transition = value as Record<string, unknown>;
  const allowed = new Set(["resolvedBeat", "closingImage", "nextChapterHook", "carryForward"]);
  if (Object.keys(transition).some((key) => !allowed.has(key))) {
    noteValidation(diagnostics, "invalid_transition_fields", { transitionPresent: true, transitionKind: "object" });
    return null;
  }
  const normalize = (field: unknown): string | null => {
    if (typeof field !== "string") return null;
    const compact = field.replace(/\s+/g, " ").trim();
    return compact.length >= 8 && compact.length <= 420 ? compact : null;
  };
  const resolvedBeat = normalize(transition.resolvedBeat);
  const closingImage = normalize(transition.closingImage);
  const nextChapterHook = normalize(transition.nextChapterHook);
  if (!resolvedBeat || !closingImage || !nextChapterHook) {
    noteValidation(diagnostics, "invalid_transition_text", { transitionPresent: true, transitionKind: "object" });
    return null;
  }
  const rawCarryForward = transition.carryForward;
  const carryForward = Array.isArray(rawCarryForward) && rawCarryForward.length >= 1 && rawCarryForward.length <= 4
    ? rawCarryForward.map(normalize)
    : null;
  if (!carryForward || carryForward.some((entry) => !entry)) {
    noteValidation(diagnostics, "invalid_transition_carry_forward", {
      transitionPresent: true,
      transitionKind: "object",
      ...(Array.isArray(rawCarryForward) ? { carryForwardCount: rawCarryForward.length } : {}),
    });
    return null;
  }
  const uniqueCarryForward = carryForward as string[];
  if (new Set(uniqueCarryForward.map((entry) => entry.toLocaleLowerCase())).size !== uniqueCarryForward.length) {
    noteValidation(diagnostics, "duplicate_transition_carry_forward", { transitionPresent: true, transitionKind: "object", carryForwardCount: uniqueCarryForward.length });
    return null;
  }
  return { resolvedBeat, closingImage, nextChapterHook, carryForward: uniqueCarryForward };
}

function previousChapterTransition(chapter: StoryChapter): ChapterTransition {
  // Legacy persisted chapters predate the transition contract. Never mutate
  // them on read; derive a compact one only for this one next-chapter prompt.
  return chapter.transition === undefined ? fallbackChapterTransition(chapter) : normalizeChapterTransition(chapter.transition) ?? fallbackChapterTransition(chapter);
}

/** Do not persist literal model cutoffs as a completed canonical chapter. */
function hasClosedNarration(value: unknown): boolean {
  return typeof value === "string" && /[.!?](?:["'”’»)\]}]*)$/.test(value.trim());
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
function normalizeChapter(payload: StoryChapter, number: number, command?: string, revision = 1, diagnostics?: CanonicalValidationDiagnostics): StoryChapter | null {
  if (!hasClosedNarration(payload.narration)) {
    noteValidation(diagnostics, "narration_unclosed", { narrationLength: typeof payload.narration === "string" ? payload.narration.trim().length : 0 });
    return null;
  }
  if (!Array.isArray(payload.beats) || payload.beats.length < 3 || payload.beats.length > 4) {
    noteValidation(diagnostics, "invalid_beat_count", { beatCount: Array.isArray(payload.beats) ? payload.beats.length : 0 });
    return null;
  }
  if (!payload.beats.every((beat) => beat && typeof beat.description === "string" && beat.description.trim() && typeof beat.caption === "string" && beat.caption.trim())) {
    noteValidation(diagnostics, "invalid_beat_shape", { beatCount: payload.beats.length });
    return null;
  }
  const id = `chapter-${number}`;
  const normalized = normalizedRevision(revision);
  const beatPrefix = normalized > 1 ? `${id}-r${normalized}` : id;
  const chapter = {
    id,
    number,
    title: payload.title,
    narration: payload.narration,
    revision: normalized,
    ...(command ? { command } : {}),
    audioDirection: normalizeAudioDirection(payload.audioDirection, `${payload.title}\n${payload.narration}`),
    beats: payload.beats.map((beat, index) => ({ ...beat, id: `${beatPrefix}-beat-${index + 1}` })),
  };
  const transition = normalizeChapterTransition(payload.transition, diagnostics);
  return transition ? { ...chapter, transition } : null;
}

function perspectiveBeatPrefix(chapter: StoryChapter, characterId: string): string {
  const revision = normalizedRevision(chapter.revision);
  return revision > 1 ? `${chapter.id}-r${revision}-${characterId}` : `${chapter.id}-${characterId}`;
}

function emptyStory(worldId: string): WorldStory {
  const time = now();
  return { worldId, characters: [], chapters: [], perspectives: [], upcomingDirections: [], worldState: "This world awaits its first generated chapter.", source: "fallback", createdAt: time, updatedAt: time };
}

/** Room for a complete chapter + strict JSON, bounded to control latency/cost. */
function storyMaxOutputTokens(): number {
  const configured = Number(process.env.STORYVERSE_STORY_MAX_OUTPUT_TOKENS ?? 6_000);
  if (!Number.isFinite(configured)) return 6_000;
  return Math.min(16_000, Math.max(1_000, Math.floor(configured)));
}

function retryOutputTokens(current: number): number {
  return Math.min(16_000, Math.max(current, current * 2));
}

function responseIsIncomplete(value: OpenAIResponsePayload): boolean {
  return value.status === "incomplete" || value.incomplete_details !== undefined && value.incomplete_details !== null;
}

function isOutputLimitReason(value: unknown): boolean {
  return value === "max_output_tokens" || value === "max_tokens";
}

function responseExceededOutputLimit(value: OpenAIResponsePayload): boolean {
  return responseIsIncomplete(value) && isOutputLimitReason(value.incomplete_details?.reason);
}

/** Some Responses-compatible gateways use `text` for a normal text content part. */
function storyOutputText(value: OpenAIResponsePayload): string | null {
  const standard = extractOutputText(value);
  if (standard) return standard;
  for (const item of value.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "text" && typeof content.text === "string" && content.text.trim()) return content.text;
    }
  }
  return null;
}

type ModelJsonAttempt<T> =
  | { kind: "success"; value: T }
  | { kind: "retryable"; reason: "max_output_tokens" | "invalid_response" }
  | { kind: "failed" };

async function requestModelJson<T>(
  key: string,
  instructions: string,
  input: string,
  responseSchema: object,
  maxOutputTokens: number,
): Promise<ModelJsonAttempt<T>> {
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        instructions,
        input,
        max_output_tokens: maxOutputTokens,
        text: { format: { type: "json_schema", name: "story_payload", strict: true, schema: responseSchema } },
      }),
    });
    if (!response.ok) {
      logWarn("story.generation.provider_error", { status: response.status });
      return { kind: "failed" };
    }
    const result = await response.json() as OpenAIResponsePayload;
    if (responseIsIncomplete(result)) {
      logWarn("story.generation.incomplete_response", responseDiagnostics(result));
      return responseExceededOutputLimit(result) ? { kind: "retryable", reason: "max_output_tokens" } : { kind: "failed" };
    }
    if (typeof result.status === "string" && result.status !== "completed") {
      logWarn("story.generation.terminal_response", responseDiagnostics(result));
      return { kind: "failed" };
    }
    const outputText = storyOutputText(result);
    if (!outputText) {
      logWarn("story.generation.invalid_response", { reason: "missing_output_text", ...responseDiagnostics(result) });
      return { kind: "retryable", reason: "invalid_response" };
    }
    try {
      return { kind: "success", value: JSON.parse(outputText) as T };
    } catch {
      logWarn("story.generation.invalid_response", { reason: "invalid_json" });
      return { kind: "retryable", reason: "invalid_response" };
    }
  } catch (error) {
    logWarn("story.generation.request_error", { reason: error instanceof Error ? error.name : "unknown" });
    return { kind: "failed" };
  }
}

/** The streaming endpoint emits completion status separately from text deltas. */
async function streamIncompleteReason(body: ReadableStream<Uint8Array>): Promise<"max_output_tokens" | "other" | null> {
  for await (const event of readProviderSse(body)) {
    try {
      const payload = JSON.parse(event.data) as {
        type?: unknown;
        status?: unknown;
        incomplete_details?: { reason?: unknown } | null;
        response?: { status?: unknown; incomplete_details?: { reason?: unknown } | null };
      };
      const incomplete = event.event === "response.incomplete" || payload.type === "response.incomplete" || payload.status === "incomplete" || payload.incomplete_details !== undefined && payload.incomplete_details !== null || payload.response?.status === "incomplete" || payload.response?.incomplete_details !== undefined && payload.response.incomplete_details !== null;
      if (incomplete) {
        const reason = payload.response?.incomplete_details?.reason ?? payload.incomplete_details?.reason;
        return isOutputLimitReason(reason) ? "max_output_tokens" : "other";
      }
    } catch {
      // The text collector owns malformed-event validation. It will reject it.
      if (event.event === "response.incomplete") return "other";
    }
  }
  return null;
}

async function modelJson<T>(instructions: string, input: string, responseSchema: object, initialOutputTokens = storyMaxOutputTokens()): Promise<T | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    logWarn("story.generation.unavailable", { reason: "missing_api_key" });
    return null;
  }
  const firstBudget = Math.min(16_000, Math.max(1_000, initialOutputTokens));
  const first = await requestModelJson<T>(key, instructions, input, responseSchema, firstBudget);
  if (first.kind === "success") return first.value;
  if (first.kind === "retryable") {
    const retryBudget = retryOutputTokens(firstBudget);
    logWarn("story.generation.retrying", { reason: first.reason, fromOutputTokens: firstBudget, toOutputTokens: retryBudget });
    const retried = await requestModelJson<T>(key, instructions, input, responseSchema, retryBudget);
    return retried.kind === "success" ? retried.value : null;
  }
  return null;
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
    const outputBudget = storyMaxOutputTokens();
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        instructions,
        input,
        max_output_tokens: outputBudget,
        stream: true,
        text: { format: { type: "json_schema", name: "story_payload", strict: true, schema: responseSchema } },
      }),
    });
    if (!response.ok || !response.body) {
      logWarn("story.generation.provider_error", { status: response.status });
      return null;
    }
    const [textBody, statusBody] = response.body.tee();
    const narrationDecoder = new NarrationJsonDeltaDecoder();
    const [streamed, incomplete] = await Promise.all([collectResponseOutputText(textBody, (rawDelta) => {
      const narration = narrationDecoder.push(rawDelta);
      if (narration) callbacks.onNarration?.(narration);
    }), streamIncompleteReason(statusBody)]);
    if (incomplete) {
      logWarn("story.generation.incomplete_response", { source: "stream", reason: incomplete });
      if (incomplete === "max_output_tokens" && outputBudget < 16_000) return modelJson<T>(instructions, input, responseSchema, retryOutputTokens(outputBudget));
      return null;
    }
    if (!streamed.ok) {
      logWarn("story.generation.stream_error", { reason: streamed.reason });
      if (streamed.reason === "invalid_response") return modelJson<T>(instructions, input, responseSchema, outputBudget);
      return null;
    }
    callbacks.onPhase?.("validating");
    try {
      return JSON.parse(streamed.outputText) as T;
    } catch {
      logWarn("story.generation.invalid_response", { reason: "invalid_json" });
      return modelJson<T>(instructions, input, responseSchema, outputBudget);
    }
  } catch (error) {
    logWarn("story.generation.request_error", { reason: error instanceof Error ? error.name : "unknown" });
    return null;
  }
}

const originalGuard = "Create original characters and an original plot. A user-supplied title or genre may evoke an existing work, but never reuse protected named characters, dialogue, plot events, costumes, or scenes from it. Do not include real-world celebrity likenesses.";
const transitionInstruction = "Write 1,200–1,700 characters of narration in four to six short paragraphs, reserving a final closing paragraph rather than writing to the response limit. Finish narration with a complete terminal sentence, never mid-sentence. Every canonical chapter must resolve one immediate beat inside its own events and end as a deliberate, satisfying unit. Return transition with resolvedBeat (what this chapter actually settles), closingImage (the earned final image), nextChapterHook (one fresh immediate pressure only), and carryForward (an array of one to four concise facts or consequences the next chapter must honor).";
const chapterRepairInstruction = "A prior draft was rejected by the canonical chapter validator. Produce a fresh, complete replacement now: write 1,200–1,600 characters in four to six short paragraphs, reserve a final closing paragraph, retain every required JSON field, include a valid transition, use three or four imageable beats, and end narration with a completed terminal sentence. Never return a partial draft.";

type CanonicalRequest = { instructions: string; input: string; responseSchema: object };

function validationLogFields(diagnostics: CanonicalValidationDiagnostics): Record<string, string | number | boolean | undefined> {
  return {
    validationReason: diagnostics.reason ?? "unknown",
    narrationLength: diagnostics.narrationLength,
    beatCount: diagnostics.beatCount,
    transitionPresent: diagnostics.transitionPresent,
    transitionKind: diagnostics.transitionKind,
    carryForwardCount: diagnostics.carryForwardCount,
    newCharacterCount: diagnostics.newCharacterCount,
    directionCount: diagnostics.directionCount,
  };
}

/** A repair is only attempted after a provider returned parseable JSON that failed local canonical validation. */
async function normalizeCanonicalWithRepair<T, R>(
  payload: T | null,
  normalize: (candidate: T, diagnostics?: CanonicalValidationDiagnostics) => R | null,
  request: CanonicalRequest,
): Promise<R | null> {
  const diagnostics: CanonicalValidationDiagnostics = {};
  const normalized = payload ? normalize(payload, diagnostics) : null;
  if (normalized || !payload) return normalized;
  logWarn("story.generation.contract_repair", { contract: "canonical_chapter", ...validationLogFields(diagnostics) });
  const repaired = await modelJson<T>(`${request.instructions} ${chapterRepairInstruction}`, request.input, request.responseSchema);
  if (!repaired) return null;
  const repairDiagnostics: CanonicalValidationDiagnostics = {};
  const repairedNormalized = normalize(repaired, repairDiagnostics);
  if (!repairedNormalized) logWarn("story.generation.contract_repair_failed", { contract: "canonical_chapter", ...validationLogFields(repairDiagnostics) });
  return repairedNormalized;
}

function normalizeInitialGeneration(payload: InitialShape, diagnostics?: CanonicalValidationDiagnostics): { characters: StoryCharacter[]; chapter: StoryChapter; worldState: string } | null {
  if (!Array.isArray(payload.characters) || !payload.chapter?.narration || !Array.isArray(payload.chapter.beats) || typeof payload.worldState !== "string") {
    noteValidation(diagnostics, "invalid_initial_shape", { beatCount: Array.isArray(payload.chapter?.beats) ? payload.chapter.beats.length : 0 });
    return null;
  }
  const characters = normalizeAdditionalCharacters(payload.characters, []);
  if (!characters || characters.length === 0) {
    noteValidation(diagnostics, "invalid_initial_characters", { newCharacterCount: Array.isArray(payload.characters) ? payload.characters.length : 0 });
    return null;
  }
  const chapter = normalizeChapter(payload.chapter, 1, undefined, 1, diagnostics);
  return chapter ? { characters, chapter, worldState: payload.worldState } : null;
}

export async function generateInitialStory(world: World): Promise<WorldStory> {
  const request: CanonicalRequest = {
    instructions: `You are StoryVerse's long-form fiction engine. ${originalGuard} Write a cinematic, anime-inspired but culturally respectful chapter. Make the cast visually distinct and keep their visual descriptions stable across future chapters. Set audioDirection from the chapter's actual emotional context: select the primary and secondary emotion, intensity 0–1, local BGM cue, and a concise narration delivery. ${transitionInstruction} No markdown.`,
    input: `World title: ${world.title}\nGenre: ${world.genre}\nCore premise: ${world.premise}\nCreative direction: ${world.creatorPrompt}\nWrite Chapter 1 and an original persistent cast appropriate to this world. The cast has no fixed size: include every character the opening genuinely needs, and make each one fully specified for later point-of-view chapters.`,
    responseSchema: schema,
  };
  const generated = await normalizeCanonicalWithRepair(await modelJson<InitialShape>(request.instructions, request.input, request.responseSchema), normalizeInitialGeneration, request);
  if (!generated) return emptyStory(world.id);
  const time = now();
  return { worldId: world.id, characters: tagCharacterOrigins(generated.characters, generated.chapter.id), chapters: [generated.chapter], perspectives: [], upcomingDirections: [], worldState: generated.worldState, source: "openai", createdAt: time, updatedAt: time };
}

type NextChapterPayload = StoryChapter & { newCharacters?: unknown };

function nextChapterRequest(world: World, story: WorldStory, command?: string): { previous: StoryChapter; directions: string[]; request: CanonicalRequest } | null {
  const previous = story.chapters.at(-1);
  if (!previous || story.characters.length === 0) return null;
  const directions = normalizedDirections(story.upcomingDirections);
  return {
    previous,
    directions,
    request: {
      instructions: `You continue an original StoryVerse serial. ${originalGuard} Preserve every existing character's visual description, personality, goal, and memories. Advance exactly one chapter with three to four imageable beats. Address or escalate the prior transition's nextChapterHook in an immediate beat early in this chapter and honor its carryForward facts. Then make this chapter complete on its own terms. Set audioDirection from the new chapter's actual emotional context: select the primary and secondary emotion, intensity 0–1, local BGM cue, and a concise narration delivery. ${transitionInstruction} Return newCharacters as an array of fully specified characters. There is no fixed maximum cast size: a queued direction may introduce any number of new characters when the story requires it. Add a new character only when the queued directions clearly justify it; otherwise return an empty array. If a queued direction requests named or new characters, introduce every requested character in the chapter prose and include a complete matching entry in newCharacters; never merely mention an unpersisted new character.`,
      input: `World: ${world.title}\nPremise: ${world.premise}\nWorld state: ${story.worldState}\nPersistent characters: ${JSON.stringify(story.characters)}\nPrevious chapter: ${previous.narration}\nPrior chapter transition (compact continuity contract): ${JSON.stringify(previousChapterTransition(previous))}\nQueued directions for this chapter: ${JSON.stringify(directions)}\nAuthor command: ${command ?? "Continue the central conflict naturally."}\nUse queued directions as story guidance, never print them as instructions. Write chapter ${previous.number + 1}.`,
      responseSchema: nextChapterSchema,
    },
  };
}

function normalizeNextChapter(payload: NextChapterPayload, story: WorldStory, previous: StoryChapter, directions: string[], command?: string, diagnostics?: CanonicalValidationDiagnostics): NextChapterGeneration | null {
  if (!payload?.narration || !Array.isArray(payload.beats)) {
    noteValidation(diagnostics, "invalid_next_chapter_shape", { beatCount: Array.isArray(payload?.beats) ? payload.beats.length : 0, directionCount: directions.length });
    return null;
  }
  const chapter = normalizeChapter(payload, previous.number + 1, command, 1, diagnostics);
  if (!chapter) return null;
  const newCharacters = normalizeAdditionalCharacters(payload.newCharacters ?? [], story.characters);
  if (!newCharacters) {
    noteValidation(diagnostics, "invalid_new_characters", { newCharacterCount: Array.isArray(payload.newCharacters) ? payload.newCharacters.length : 0, directionCount: directions.length });
    return null;
  }
  // New cast members are permitted only as part of fulfilling a pending
  // direction; reject an unexpected expansion instead of silently dropping it.
  if (directions.length === 0 && newCharacters.length > 0) {
    noteValidation(diagnostics, "unexpected_new_characters", { newCharacterCount: newCharacters.length, directionCount: directions.length });
    return null;
  }
  return { chapter, newCharacters: tagCharacterOrigins(newCharacters, chapter.id) };
}

export async function generateNextChapter(world: World, story: WorldStory, command?: string): Promise<NextChapterGeneration | null> {
  const request = nextChapterRequest(world, story, command);
  if (!request) return null;
  const normalize = (payload: NextChapterPayload, diagnostics?: CanonicalValidationDiagnostics) => normalizeNextChapter(payload, story, request.previous, request.directions, command, diagnostics);
  return normalizeCanonicalWithRepair(await modelJson<NextChapterPayload>(request.request.instructions, request.request.input, request.request.responseSchema), normalize, request.request);
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
  const normalize = (payload: NextChapterPayload, diagnostics?: CanonicalValidationDiagnostics) => normalizeNextChapter(payload, story, request.previous, request.directions, command, diagnostics);
  return normalizeCanonicalWithRepair(await modelJsonStream<NextChapterPayload>(request.request.instructions, request.request.input, request.request.responseSchema, callbacks), normalize, request.request);
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
