import type { CreateWorldInput, World } from "./worlds.js";
import { extractOutputText, type OpenAIResponsePayload } from "./openai-response.js";

type GeneratedWorld = Pick<World, "openingScene" | "characters" | "source">;

function normalizeBlueprintCharacters(value: unknown): World["characters"] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const characters: World["characters"] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const candidate = raw as Partial<World["characters"][number]>;
    if (![candidate.name, candidate.role, candidate.trait].every((field) => typeof field === "string" && field.trim().length > 0)) return null;
    characters.push({ name: candidate.name!.trim(), role: candidate.role!.trim(), trait: candidate.trait!.trim() });
  }
  return characters;
}

function fallback(input: CreateWorldInput): GeneratedWorld {
  return {
    // Do not invent a canned cast for a user-created world. If generation is
    // unavailable, preserve the creator's premise and leave the cast unassigned.
    openingScene: `The story opens in ${input.title}. ${input.premise}`,
    characters: [],
    source: "fallback",
  };
}

export async function generateWorld(input: CreateWorldInput): Promise<GeneratedWorld> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return fallback(input);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        instructions: "You create concise, original interactive story worlds. Use clear, natural Indian English with simple vocabulary, short sentences, and a short opening paragraph. Avoid heavy literary words, American slang, and exaggerated Indian expressions. Never imitate a named author or existing franchise. Return only JSON matching the requested schema. Create a persistent cast appropriate to the brief; do not limit it to a fixed number of characters.",
        input: `Create an original world from this brief. Title: ${input.title}. Genre: ${input.genre}. Premise: ${input.premise}. Creator note: ${input.creatorPrompt}. Include every core character this world needs, each with a concise role and trait.`,
        text: {
          format: {
            type: "json_schema", name: "world_blueprint", strict: true,
            schema: {
              type: "object", additionalProperties: false, required: ["openingScene", "characters"],
              properties: {
                openingScene: { type: "string", minLength: 80, maxLength: 600 },
                characters: {
                  type: "array", minItems: 1,
                  items: {
                    type: "object", additionalProperties: false, required: ["name", "role", "trait"],
                    properties: { name: { type: "string" }, role: { type: "string" }, trait: { type: "string" } },
                  },
                },
              },
            },
          },
        },
      }),
    });
    if (!response.ok) return fallback(input);
    const payload = await response.json() as OpenAIResponsePayload;
    const parsed = JSON.parse(extractOutputText(payload) ?? "") as Omit<GeneratedWorld, "source">;
    const characters = normalizeBlueprintCharacters(parsed.characters);
    if (!parsed.openingScene || !characters) return fallback(input);
    return { openingScene: parsed.openingScene, characters, source: "openai" };
  } catch {
    return fallback(input);
  }
}
