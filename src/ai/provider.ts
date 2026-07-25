import { buildScenePrompt } from "./context";
import type { SceneGenerationInput, SceneProvider } from "./types";

type FetchLike = typeof fetch;

type OpenAICompatibleProviderOptions = {
  endpoint: string;
  apiKey?: string;
  model?: string;
  fetchImpl?: FetchLike;
};

/**
 * Server-only adapter for an OpenAI-compatible JSON endpoint. It is never
 * constructed automatically in the browser, so credentials stay out of bundles.
 */
export function createOpenAICompatibleProvider(options: OpenAICompatibleProviderOptions): SceneProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async generate(input: SceneGenerationInput): Promise<unknown> {
      const response = await fetchImpl(options.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: options.model ?? "gpt-4o-mini",
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: buildScenePrompt(input) }],
        }),
      });
      if (!response.ok) throw new Error(`Scene provider returned HTTP ${response.status}`);
      const payload = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("Scene provider returned no message content");
      try {
        return JSON.parse(content) as unknown;
      } catch {
        throw new Error("Scene provider returned invalid JSON");
      }
    },
  };
}

type ServerEnvironment = {
  STORYVERSE_SCENE_ENDPOINT?: string;
  STORYVERSE_SCENE_API_KEY?: string;
  STORYVERSE_SCENE_MODEL?: string;
  // Backwards-compatible aliases used by the repository's .env.example.
  STORYVERSE_MODEL_BASE_URL?: string;
  STORYVERSE_MODEL_API_KEY?: string;
  STORYVERSE_MODEL?: string;
};

/**
 * Reads ordinary server environment variables only. It deliberately does not use
 * Vite's `import.meta.env`, which would make a secret eligible for client bundling.
 */
export function createConfiguredSceneProvider(environment?: ServerEnvironment): SceneProvider | undefined {
  const processEnvironment = (globalThis as unknown as { process?: { env?: ServerEnvironment } }).process?.env;
  const configured = environment ?? processEnvironment;
  if (!configured) return undefined;
  const configuredBaseUrl = configured?.STORYVERSE_MODEL_BASE_URL?.replace(/\/$/, "");
  const endpoint = configured?.STORYVERSE_SCENE_ENDPOINT ?? (configuredBaseUrl ? `${configuredBaseUrl}/chat/completions` : undefined);
  if (!endpoint) return undefined;
  return createOpenAICompatibleProvider({
    endpoint,
    apiKey: configured.STORYVERSE_SCENE_API_KEY ?? configured.STORYVERSE_MODEL_API_KEY,
    model: configured.STORYVERSE_SCENE_MODEL ?? configured.STORYVERSE_MODEL,
  });
}
