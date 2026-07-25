import { ImageGenerationError, type GeneratedImage, type ImageGenerationInput, type ImageGenerator } from "./types.js";

function timeoutSignal(milliseconds: number): AbortSignal {
  return AbortSignal.timeout(Math.max(500, milliseconds));
}

export class DisabledImageGenerator implements ImageGenerator {
  public readonly name = "disabled";
  public readonly isAvailable = false;
  public async generate(input: ImageGenerationInput): Promise<GeneratedImage> {
    void input;
    throw new ImageGenerationError("disabled", "No image provider is configured");
  }
}

export class MockImageGenerator implements ImageGenerator {
  public readonly name = "mock";
  public readonly isAvailable = true;
  public calls = 0;
  public constructor(private readonly behavior: "success" | "error" | "invalid" | "timeout" = "success") {}
  public async generate(input: ImageGenerationInput): Promise<GeneratedImage> {
    this.calls += 1;
    if (this.behavior === "timeout") throw new ImageGenerationError("timeout", "Mock timeout");
    if (this.behavior === "error") throw new ImageGenerationError("provider_error", "Mock provider failure");
    if (this.behavior === "invalid") throw new ImageGenerationError("invalid_response", "Mock invalid response");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="100%" height="100%" fill="#17213e"/><circle cx="512" cy="430" r="240" fill="#d28b35" opacity=".7"/><path d="M0 800L420 500 740 800 1024 560v464H0z" fill="#080a11"/></svg>`;
    return { bytes: Buffer.from(svg), contentType: "image/svg+xml", provider: "mock", providerAssetId: input.cacheKey };
  }
}

export class OpenAIImageGenerator implements ImageGenerator {
  public readonly name = "openai";
  public readonly isAvailable = true;
  public constructor(private readonly apiKey: string, private readonly timeoutMs = 180_000) {}
  public async generate(input: ImageGenerationInput): Promise<GeneratedImage> {
    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        signal: timeoutSignal(this.timeoutMs),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2", prompt: input.prompt, size: input.size, quality: input.quality, output_format: "png" }),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new ImageGenerationError("timeout", "Image provider timed out");
      throw new ImageGenerationError("provider_error", "Image provider could not be reached");
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: { type?: unknown; code?: unknown } } | null;
      const providerType = typeof payload?.error?.type === "string" ? payload.error.type.slice(0, 80) : undefined;
      const providerCode = typeof payload?.error?.code === "string" ? payload.error.code.slice(0, 80) : undefined;
      // Deliberately omit provider error messages: they can echo a submitted prompt.
      throw new ImageGenerationError("provider_error", `Image provider returned ${response.status}`, { providerStatus: response.status, providerType, providerCode });
    }
    const payload = await response.json() as { data?: Array<{ b64_json?: string; revised_prompt?: string }> };
    const base64 = payload.data?.[0]?.b64_json;
    if (!base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) throw new ImageGenerationError("invalid_response", "Image provider response did not include image bytes");
    const bytes = Buffer.from(base64, "base64");
    if (bytes.length < 32 || bytes.length > 25 * 1024 * 1024) throw new ImageGenerationError("invalid_response", "Image provider returned an unsafe image payload");
    return { bytes, contentType: "image/png", provider: "openai" };
  }
}

export function createImageGenerator(environment: NodeJS.ProcessEnv = process.env): ImageGenerator {
  if (environment.STORYVERSE_IMAGE_PROVIDER === "mock") return new MockImageGenerator();
  if (!environment.OPENAI_API_KEY) return new DisabledImageGenerator();
  const timeoutMs = Number(environment.STORYVERSE_IMAGE_TIMEOUT_MS || 180_000);
  return new OpenAIImageGenerator(environment.OPENAI_API_KEY, Number.isFinite(timeoutMs) ? timeoutMs : 180_000);
}
