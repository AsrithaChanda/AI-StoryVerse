import type { CreateWorldInput, World } from "./worlds.js";
import { extractOutputText, type OpenAIResponsePayload } from "./openai-response.js";

type GeneratedWorld = Pick<World, "openingScene" | "characters" | "source">;

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
        instructions: "You create concise, original interactive story worlds. Never imitate a named author or existing franchise. Return only JSON matching the requested schema.",
        input: `Create an original world from this brief. Title: ${input.title}. Genre: ${input.genre}. Premise: ${input.premise}. Creator note: ${input.creatorPrompt}.`,
        text: {
          format: {
            type: "json_schema", name: "world_blueprint", strict: true,
            schema: {
              type: "object", additionalProperties: false, required: ["openingScene", "characters"],
              properties: {
                openingScene: { type: "string", minLength: 80, maxLength: 600 },
                characters: {
                  type: "array", minItems: 3, maxItems: 3,
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
    if (!parsed.openingScene || !Array.isArray(parsed.characters) || parsed.characters.length !== 3) return fallback(input);
    return { openingScene: parsed.openingScene, characters: parsed.characters, source: "openai" };
  } catch {
    return fallback(input);
  }
}
