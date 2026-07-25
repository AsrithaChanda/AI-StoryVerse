import "dotenv/config";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import { generateWorld } from "./generation.js";
import { createImageRouter } from "./image-routes.js";
import { createChapterAudioRouter } from "./chapter-audio-routes.js";
import { createStoryImagePipeline } from "./images/pipeline.js";
import { createStoryRouter } from "./story-routes.js";
import { generateInitialStory } from "./story.js";
import { apiRequestLogger, logInfo } from "./logger.js";
import { WorldStore, type CreateWorldInput } from "./worlds.js";

const dataDir = resolve(process.cwd(), "data");
mkdirSync(dataDir, { recursive: true });
const store = new WorldStore(new DatabaseSync(resolve(dataDir, "storyverse.db")));
const imagePipeline = createStoryImagePipeline(store);
const app = express();
app.use(express.json({ limit: "32kb" }));
app.use(apiRequestLogger);

function validInput(value: unknown): value is CreateWorldInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return ["title", "premise", "genre", "creatorPrompt"].every((key) => typeof input[key] === "string" && input[key].trim().length >= 3 && input[key].trim().length <= 1000);
}

app.get("/api/health", (_request, response) => response.json({ ok: true, database: "sqlite", modelConfigured: Boolean(process.env.OPENAI_API_KEY) }));
app.get("/api/worlds", (_request, response) => response.json({ worlds: store.list() }));
app.get("/api/worlds/:id", (request, response) => {
  const world = store.get(request.params.id);
  return world ? response.json({ world }) : response.status(404).json({ error: "World not found" });
});
app.post("/api/worlds", async (request, response) => {
  if (!validInput(request.body)) return response.status(400).json({ error: "title, premise, genre, and creatorPrompt must each be 3–1000 characters" });
  try {
    const input = Object.fromEntries(Object.entries(request.body).map(([key, value]) => [key, (value as string).trim()])) as CreateWorldInput;
    const world = store.create(input, await generateWorld(input));
    // Chapter 1 and its persistent cast are part of world creation. A model
    // failure stores an empty fallback story without rejecting the new world.
    store.saveWorldStory(await generateInitialStory(world));
    // Persisting a world succeeds independently; the optional cover work follows asynchronously.
    void imagePipeline.generate({ worldId: world.id, sceneId: "world-cover", moment: "world_cover" }).catch(() => undefined);
    return response.status(201).json({ world });
  } catch (error) {
    const message = error instanceof Error && /UNIQUE/.test(error.message) ? "A world with that title already exists" : "Unable to create world";
    return response.status(409).json({ error: message });
  }
});
app.use("/api", createImageRouter({ store, pipeline: imagePipeline }));
app.use("/api", createChapterAudioRouter(store));
app.use("/api", createStoryRouter(store));

const builtApp = resolve(process.cwd(), "dist", "index.html");
if (existsSync(builtApp)) {
  app.use(express.static(resolve(process.cwd(), "dist")));
  app.get(/^(?!\/api\/).*/, (_request, response) => response.sendFile(builtApp));
}

const port = Number(process.env.PORT || 8787);
app.listen(port, "127.0.0.1", () => logInfo("server.started", { port, database: "sqlite", modelConfigured: Boolean(process.env.OPENAI_API_KEY) }));
