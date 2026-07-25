import { z } from "zod";

/** A line is deliberately small: canonical world changes never come from prose. */
export const DialogueLineSchema = z.object({
  characterId: z.enum(["mira", "ravi", "kael"]),
  text: z.string().trim().min(1).max(420),
});

export const ScenePayloadSchema = z.object({
  title: z.string().trim().min(3).max(90),
  narration: z.string().trim().min(80).max(1_500),
  dialogue: z.array(DialogueLineSchema).min(1).max(4),
  closingHook: z.string().trim().min(8).max(280),
});

export type ScenePayload = z.infer<typeof ScenePayloadSchema>;
export type SceneSource = "provider" | "fallback";
export type FallbackReason = "no_provider" | "timeout" | "provider_error" | "invalid_response";

export type GeneratedScene = ScenePayload & {
  source: SceneSource;
  fallbackReason?: FallbackReason;
};

export type SceneGenerationInput = {
  universeTitle: "The Last Ember";
  universeRules: readonly string[];
  branchId: string;
  branchName: string;
  protagonistId: "mira" | "ravi" | "kael";
  protagonistName: string;
  protagonist: {
    personality: readonly string[];
    knownFacts: readonly string[];
    memories: readonly string[];
    beliefs: readonly string[];
  };
  worldState: Record<string, string | number | boolean>;
  recentEvents: readonly string[];
  requiredConsequences: readonly string[];
  decision?: "TRUST_KAEL" | "EXPOSE_KAEL";
  mode: "decision" | "protagonist";
};

/**
 * Structural source accepted by buildSceneInput. Keeping this independent of the
 * reducer makes the adapter usable in browser demos and a future server route.
 */
export type SceneInputSource = Omit<SceneGenerationInput, "universeTitle" | "universeRules"> & {
  universeTitle?: "The Last Ember";
  universeRules?: readonly string[];
};

export type SceneProvider = {
  generate(input: SceneGenerationInput): Promise<unknown>;
};

export type SceneGenerator = {
  generate(input: SceneGenerationInput): Promise<GeneratedScene>;
};

export type SceneGeneratorOptions = {
  /** An injected server-side provider. Browser callers should omit this. */
  provider?: SceneProvider;
  timeoutMs?: number;
  /** Number of retries after the first attempt. Defaults to one. */
  retries?: number;
};
