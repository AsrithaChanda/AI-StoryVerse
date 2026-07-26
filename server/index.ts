import "dotenv/config";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import { createChapterAudioRouter } from "./chapter-audio-routes.js";
import { generateWorld } from "./generation.js";
import { createImageRouter } from "./image-routes.js";
import { LocalImageAssetStore, StoryImageAssetStore } from "./images/assets.js";
import { createStoryImagePipeline } from "./images/pipeline.js";
import { apiRequestLogger, logError, logInfo, logWarn } from "./logger.js";
import { createRuntimeStore } from "./runtime-store.js";
import { createStoryRouter } from "./story-routes.js";
import { createStoryTrailerRouter } from "./story-trailer-routes.js";
import { createAssetStoreFromEnvironment } from "./storage/index.js";
import { generateInitialStory } from "./story.js";
import type { CreateWorldInput } from "./worlds.js";

function validInput(value: unknown): value is CreateWorldInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return ["title", "premise", "genre", "creatorPrompt"].every((key) => typeof input[key] === "string" && input[key].trim().length >= 3 && input[key].trim().length <= 1000);
}

async function start(): Promise<void> {
  const persistence = await createRuntimeStore().catch((error: unknown) => {
    logError("persistence.initialization_failed", { errorCode: safeErrorCode(error) });
    throw error;
  });
  const assetStore = (() => {
    try {
      return createAssetStoreFromEnvironment();
    } catch (error) {
      logError("asset_storage.initialization_failed", { errorCode: safeErrorCode(error) });
      throw error;
    }
  })();
  const configuredAssetStore = (process.env.STORYVERSE_ASSET_STORAGE ?? "local").trim().toLowerCase();
  const assetBackend = configuredAssetStore === "databricks" || configuredAssetStore === "databricks-volume" ? "databricks-volume" : "local";
  // Preserve pre-existing local image/narration URLs during the rollout. The
  // configured Databricks backend uses one Volume with media namespaces.
  const imageAssets = assetBackend === "databricks-volume" ? new StoryImageAssetStore(assetStore) : new LocalImageAssetStore();
  const imagePipeline = createStoryImagePipeline(persistence.store, { assets: imageAssets });
  const app = express();

  app.use(express.json({ limit: "32kb" }));
  app.use(apiRequestLogger);

  app.get("/api/health", (_request, response) => response.json({
    ok: true,
    database: persistence.kind,
    assetStorage: assetBackend,
    modelConfigured: Boolean(process.env.OPENAI_API_KEY),
  }));
  app.get("/api/worlds", async (_request, response) => response.json({ worlds: await persistence.store.list() }));
  app.get("/api/worlds/:id", async (request, response) => {
    const world = await persistence.store.get(request.params.id);
    return world ? response.json({ world }) : response.status(404).json({ error: "World not found" });
  });
  app.delete("/api/worlds/:id", async (request, response) => {
    const deletedId = request.params.id;
    if (!await persistence.store.deleteWorld(deletedId)) return response.status(404).json({ error: "World not found" });
    return response.json({ deleted: true, deletedId });
  });
  app.post("/api/worlds", async (request, response) => {
    if (!validInput(request.body)) return response.status(400).json({ error: "title, premise, genre, and creatorPrompt must each be 3–1000 characters" });
    try {
      const input = Object.fromEntries(Object.entries(request.body).map(([key, value]) => [key, (value as string).trim()])) as CreateWorldInput;
      const world = await persistence.store.create(input, await generateWorld(input));
      // Chapter 1 and its persistent cast are stored with the world. A model
      // failure saves an empty fallback story rather than rejecting creation.
      const initial = await persistence.store.saveWorldStory(await generateInitialStory(world));
      if (!initial) logWarn("story.initial.persistence_conflict", { worldId: world.id });
      // Cover preparation is optional and never makes a new world unavailable.
      void imagePipeline.generate({ worldId: world.id, sceneId: "world-cover", moment: "world_cover" }).catch(() => undefined);
      return response.status(201).json({ world });
    } catch (error) {
      const message = error instanceof Error && /UNIQUE|duplicate key/i.test(error.message) ? "A world with that title already exists" : "Unable to create world";
      return response.status(409).json({ error: message });
    }
  });

  app.use("/api", createImageRouter({ store: persistence.store, assets: imageAssets, pipeline: imagePipeline }));
  app.use("/api", createChapterAudioRouter(persistence.store, assetBackend === "databricks-volume" ? assetStore : undefined));
  app.use("/api", createStoryRouter(persistence.store));
  app.use("/api", createStoryTrailerRouter({ store: persistence.store, assets: assetStore }));

  const builtApp = resolve(process.cwd(), "dist", "index.html");
  if (existsSync(builtApp)) {
    app.use(express.static(resolve(process.cwd(), "dist")));
    app.get(/^(?!\/api\/).*/, (_request, response) => response.sendFile(builtApp));
  }

  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST?.trim() || "0.0.0.0";
  const server = app.listen(port, host, () => logInfo("server.started", {
    port,
    host,
    database: persistence.kind,
    assetStorage: assetBackend,
    modelConfigured: Boolean(process.env.OPENAI_API_KEY),
  }));

  const close = (signal: string) => {
    logInfo("server.stopping", { signal });
    server.close(() => {
      void persistence.close?.().finally(() => process.exit(0));
    });
  };
  process.once("SIGINT", () => close("SIGINT"));
  process.once("SIGTERM", () => close("SIGTERM"));
}

function safeErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(code) ? code : "unknown";
}

void start().catch(() => {
  // Deliberately do not serialize driver errors here: they can contain a DSN.
  logError("server.start_failed", { reason: "persistence_or_asset_initialization_failed" });
  process.exitCode = 1;
});
