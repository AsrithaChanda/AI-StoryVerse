import type { SceneGenerationInput, SceneInputSource } from "./types";

const DEFAULT_RULES = [
  "Astra survives on the failing Ember Core beneath its palace.",
  "Do not change canonical world state; narrate only the supplied consequences.",
  "Do not reveal a secret the protagonist does not know.",
  "Do not introduce a major character, death, revival, or another timeline branch.",
];

const KAEL_PRIVATE_SECRET = /(?:kael(?:'s)?\s+)?(?:removed|stole|took)\s+the\s+(?:ember\s+)?fragment\s+(?:to|because|so)\s+(?:stop|prevent|avoid)\b[^.]*\.?/gi;

function sanitizeForProtagonist(value: string, protagonistId: SceneGenerationInput["protagonistId"]): string {
  if (protagonistId !== "ravi") return value;
  // Ravi may know Kael is under suspicion, but not Kael's private motive.
  return value.replace(KAEL_PRIVATE_SECRET, "").replace(/\s{2,}/g, " ").trim();
}

function sanitizeList(values: readonly string[], protagonistId: SceneGenerationInput["protagonistId"]): string[] {
  return values
    .map((value) => sanitizeForProtagonist(value, protagonistId))
    .filter(Boolean);
}

function sanitizeWorldState(
  worldState: SceneGenerationInput["worldState"],
  protagonistId: SceneGenerationInput["protagonistId"],
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(worldState)
      .map(([key, value]) => [key, typeof value === "string" ? sanitizeForProtagonist(value, protagonistId) : value] as const)
      .filter(([, value]) => value !== ""),
  );
}

/**
 * Creates the model-facing projection. It intentionally contains only the active
 * protagonist's memories, beliefs, and known facts—not other character records.
 */
export function buildSceneInput(source: SceneInputSource): SceneGenerationInput {
  const protagonistId = source.protagonistId;
  return {
    universeTitle: source.universeTitle ?? "The Last Ember",
    universeRules: source.universeRules ?? DEFAULT_RULES,
    branchId: source.branchId,
    branchName: source.branchName,
    protagonistId,
    protagonistName: source.protagonistName,
    protagonist: {
      personality: [...source.protagonist.personality],
      knownFacts: sanitizeList(source.protagonist.knownFacts, protagonistId),
      memories: sanitizeList(source.protagonist.memories, protagonistId),
      beliefs: sanitizeList(source.protagonist.beliefs, protagonistId),
    },
    worldState: sanitizeWorldState(source.worldState, protagonistId),
    recentEvents: sanitizeList(source.recentEvents, protagonistId),
    requiredConsequences: sanitizeList(source.requiredConsequences, protagonistId),
    decision: source.decision,
    mode: source.mode,
  };
}

/** The serialized prompt is useful to a server-side adapter and easy to audit. */
export function buildScenePrompt(input: SceneGenerationInput): string {
  return [
    `You are writing a concise cinematic continuation for ${input.universeTitle}.`,
    "Return JSON only with title, narration, dialogue, and closingHook.",
    `Universe rules: ${input.universeRules.join(" ")}`,
    `Branch: ${input.branchName} (${input.branchId}).`,
    `Protagonist: ${input.protagonistName} (${input.protagonistId}).`,
    `Personality: ${input.protagonist.personality.join(", ") || "not supplied"}.`,
    `Known facts: ${input.protagonist.knownFacts.join(" | ") || "none supplied"}.`,
    `Memories: ${input.protagonist.memories.join(" | ") || "none supplied"}.`,
    `Beliefs: ${input.protagonist.beliefs.join(" | ") || "none supplied"}.`,
    `World state: ${JSON.stringify(input.worldState)}.`,
    `Committed events: ${input.recentEvents.join(" | ") || "none"}.`,
    `Required deterministic consequences: ${input.requiredConsequences.join(" | ") || "none"}.`,
    "Never decide a new canonical consequence or reveal hidden information.",
  ].join("\n");
}
