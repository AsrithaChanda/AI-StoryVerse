import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createPostgresWorldStoreFromEnv, type StoryStore } from "./persistence/index.js";
import { WorldStore } from "./worlds.js";

export type RuntimeStore = {
  store: StoryStore;
  kind: "postgres" | "sqlite";
  close?: () => Promise<void>;
};

/**
 * PostgreSQL/Lakebase is selected only when a database connection is supplied.
 * A developer can still run the complete demo offline with the existing
 * SQLite store, avoiding an accidental dependency on Docker or Databricks.
 */
export async function createRuntimeStore(
  environment: Record<string, string | undefined> = process.env,
): Promise<RuntimeStore> {
  const postgres = await createPostgresWorldStoreFromEnv({ environment });
  if (postgres) return { store: postgres, kind: "postgres", close: () => postgres.close() };

  const dataDirectory = resolve(process.cwd(), "data");
  mkdirSync(dataDirectory, { recursive: true });
  const databasePath = environment.STORYVERSE_SQLITE_PATH?.trim() || resolve(dataDirectory, "storyverse.db");
  return { store: new WorldStore(new DatabaseSync(databasePath)), kind: "sqlite" };
}
