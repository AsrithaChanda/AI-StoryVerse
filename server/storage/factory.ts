import { resolve } from "node:path";
import { DatabricksVolumeAssetStore, type DatabricksFetch } from "./databricks-volume-asset-store.js";
import { LocalAssetStore } from "./local-asset-store.js";
import { AssetStoreError, type AssetStore } from "./types.js";

export type AssetStoreFactoryOptions = {
  environment?: NodeJS.ProcessEnv;
  fetch?: DatabricksFetch;
  localDirectory?: string;
};

/**
 * Selects local persistence by default. Production must explicitly set
 * STORYVERSE_ASSET_STORAGE=databricks so incomplete Databricks configuration
 * fails fast instead of silently writing to an ephemeral local disk.
 */
export function createAssetStoreFromEnvironment(options: AssetStoreFactoryOptions = {}): AssetStore {
  const environment = options.environment ?? process.env;
  const provider = (environment.STORYVERSE_ASSET_STORAGE ?? "local").trim().toLowerCase();
  if (provider === "local" || provider === "filesystem") {
    return new LocalAssetStore(options.localDirectory ?? environment.STORYVERSE_ASSET_DIRECTORY ?? resolve(process.cwd(), "data", "story-assets"));
  }
  if (provider === "databricks" || provider === "databricks-volume") {
    return new DatabricksVolumeAssetStore({
      host: environment.DATABRICKS_HOST ?? "",
      token: environment.DATABRICKS_TOKEN ?? "",
      volumePath: environment.DATABRICKS_VOLUME_PATH ?? "",
      fetch: options.fetch,
    });
  }
  throw new AssetStoreError("configuration", "STORYVERSE_ASSET_STORAGE must be local or databricks.");
}
