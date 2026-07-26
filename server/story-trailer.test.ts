import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OpenAIStoryTrailerProvider,
  StoryTrailerError,
  createStoryTrailerProviderFromEnvironment,
} from "./story-trailer.js";

const originalApiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
});

describe("OpenAI story trailer provider", () => {
  it("uses the configured server environment key", () => {
    process.env.OPENAI_API_KEY = "server-test-key";
    expect(createStoryTrailerProviderFromEnvironment().isAvailable).toBe(true);
  });

  it("starts a video job using multipart fields without exposing the key", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe("https://api.openai.com/v1/videos");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer server-test-key");
      expect(init?.body).toBeInstanceOf(FormData);
      const body = init?.body as FormData;
      expect(body.get("model")).toBe("sora-2");
      expect(body.get("prompt")).toBe("An original cinematic world.");
      expect(body.get("seconds")).toBe("8");
      expect(body.get("size")).toBe("1280x720");
      return Response.json({ id: "video_job_123", status: "queued", progress: 0 });
    });
    const provider = new OpenAIStoryTrailerProvider({
      apiKey: "server-test-key",
      fetch: fetcher,
      timeoutMs: 5_000,
    });

    await expect(provider.create({
      prompt: "An original cinematic world.",
      seconds: 8,
      size: "1280x720",
    })).resolves.toEqual({
      id: "video_job_123",
      status: "queued",
      progress: 0,
      providerAssetId: undefined,
      errorCode: undefined,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("remains disabled without an API key", async () => {
    delete process.env.OPENAI_API_KEY;
    const provider = new OpenAIStoryTrailerProvider({ apiKey: "" });
    expect(provider.isAvailable).toBe(false);
    await expect(provider.create({
      prompt: "A trailer.",
      seconds: 8,
      size: "1280x720",
    })).rejects.toMatchObject({ code: "provider_disabled", statusCode: 503 } satisfies Partial<StoryTrailerError>);
  });
});
