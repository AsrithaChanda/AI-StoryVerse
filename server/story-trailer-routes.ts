import { Router, type Request, type Response } from "express";
import type { StoryStore } from "./persistence/store.js";
import type { AssetStore, StoredAsset } from "./storage/index.js";
import {
  StoryTrailerError,
  StoryTrailerService,
  type StoryTrailerServiceOptions,
} from "./story-trailer.js";

export type StoryTrailerRouterOptions = {
  store: StoryStore;
  assets: AssetStore;
  service?: StoryTrailerService;
};

type ByteRange = { start: number; end: number };

export function createStoryTrailerRouter(options: StoryTrailerRouterOptions): Router {
  const router = Router();
  const serviceOptions: StoryTrailerServiceOptions = { store: options.store, assets: options.assets };
  const service = options.service ?? new StoryTrailerService(serviceOptions);

  router.get("/worlds/:worldId/story/trailer", async (request, response) => {
    try {
      return response.json({ trailer: await service.get(request.params.worldId) });
    } catch (error) {
      return storyTrailerErrorResponse(response, error);
    }
  });

  router.post("/worlds/:worldId/story/trailer", async (request, response) => {
    if (!validStartBody(request.body)) {
      return response.status(400).json({
        error: "The trailer request must be empty or contain only a boolean retry field.",
        code: "invalid_request",
      });
    }
    try {
      const trailer = await service.start(request.params.worldId, request.body.retry === true);
      const status = trailer.status === "queued" || trailer.status === "in_progress" ? 202 : 200;
      return response.status(status).json({ trailer });
    } catch (error) {
      return storyTrailerErrorResponse(response, error);
    }
  });

  router.get("/worlds/:worldId/story/trailer/assets/:filename", async (request, response) => {
    try {
      const asset = await service.getAsset(request.params.worldId, request.params.filename);
      if (!asset) return response.status(404).json({ error: "Story trailer not found.", code: "trailer_not_found" });
      return sendVideoAsset(request, response, asset);
    } catch (error) {
      return storyTrailerErrorResponse(response, error);
    }
  });

  return router;
}

function validStartBody(value: unknown): value is { retry?: boolean } {
  if (value === undefined || value === null) return true;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.every(([key, item]) => key === "retry" && typeof item === "boolean");
}

function storyTrailerErrorResponse(response: Response, error: unknown): Response {
  if (error instanceof StoryTrailerError) {
    return response.status(error.statusCode).json({
      error: error.message,
      code: publicErrorCode(error.code),
    });
  }
  return response.status(500).json({
    error: "The trailer service could not complete that request.",
    code: "trailer_service_error",
  });
}

function publicErrorCode(code: StoryTrailerError["code"]): string {
  switch (code) {
    case "provider_disabled": return "video_provider_unavailable";
    case "timeout": return "video_timed_out";
    case "provider_error":
    case "invalid_response": return "video_provider_error";
    default: return code;
  }
}

function sendVideoAsset(request: Request, response: Response, asset: StoredAsset): Response {
  const total = asset.bytes.byteLength;
  response.set({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "Content-Type": asset.contentType || "video/mp4",
    "X-Content-Type-Options": "nosniff",
  });

  const requestedRange = request.headers.range;
  if (!requestedRange) {
    response.set("Content-Length", String(total));
    return response.status(200).send(Buffer.from(asset.bytes));
  }

  const range = parseByteRange(requestedRange, total);
  if (!range) {
    response.set("Content-Range", `bytes */${total}`);
    return response.status(416).end();
  }

  const chunk = asset.bytes.subarray(range.start, range.end + 1);
  response.set({
    "Content-Length": String(chunk.byteLength),
    "Content-Range": `bytes ${range.start}-${range.end}/${total}`,
  });
  return response.status(206).send(Buffer.from(chunk));
}

export function parseByteRange(value: string, total: number): ByteRange | null {
  if (!Number.isSafeInteger(total) || total <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, total - suffixLength), end: total - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : total - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= total || requestedEnd < start) {
    return null;
  }
  return { start, end: Math.min(requestedEnd, total - 1) };
}
