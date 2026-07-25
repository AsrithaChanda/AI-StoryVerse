import { selectFallbackScene } from "./fallbacks";
import { ScenePayloadSchema } from "./types";
import type {
  FallbackReason,
  GeneratedScene,
  SceneGenerationInput,
  SceneGenerator,
  SceneGeneratorOptions,
} from "./types";

class SceneTimeoutError extends Error {
  constructor() {
    super("Scene provider timed out");
    this.name = "SceneTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new SceneTimeoutError()), timeoutMs);
    promise.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function createSceneGenerator(options: SceneGeneratorOptions = {}): SceneGenerator {
  const retries = Math.max(0, options.retries ?? 1);
  const timeoutMs = Math.max(1, options.timeoutMs ?? 2_500);

  return {
    async generate(input: SceneGenerationInput): Promise<GeneratedScene> {
      if (!options.provider) {
        return { ...selectFallbackScene(input), fallbackReason: "no_provider" };
      }

      let reason: FallbackReason = "provider_error";
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
          const raw = await withTimeout(options.provider.generate(input), timeoutMs);
          const parsed = ScenePayloadSchema.safeParse(raw);
          if (parsed.success) return { ...parsed.data, source: "provider" };
          reason = "invalid_response";
        } catch (error) {
          reason = error instanceof SceneTimeoutError ? "timeout" : "provider_error";
        }
      }
      return { ...selectFallbackScene(input), fallbackReason: reason };
    },
  };
}
