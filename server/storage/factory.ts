import { resolve } from "node:path";
import { DatabricksOAuthM2MTokenProvider, DatabricksVolumeAssetStore, type DatabricksFetch } from "./databricks-volume-asset-store.js";
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
    const staticToken = environment.DATABRICKS_TOKEN;
    const clientId = environment.DATABRICKS_CLIENT_ID;
    const clientSecret = environment.DATABRICKS_CLIENT_SECRET;
    const hasStaticToken = Boolean(staticToken?.trim());
    const hasClientId = Boolean(clientId?.trim());
    const hasClientSecret = Boolean(clientSecret?.trim());
    if (hasStaticToken && (hasClientId || hasClientSecret)) {
      throw new AssetStoreError("configuration", "Configure either DATABRICKS_TOKEN or DATABRICKS_CLIENT_ID plus DATABRICKS_CLIENT_SECRET, not both.");
    }
    if (!hasStaticToken && hasClientId !== hasClientSecret) {
      throw new AssetStoreError("configuration", "Set both DATABRICKS_CLIENT_ID and DATABRICKS_CLIENT_SECRET for Databricks OAuth authentication.");
    }
    return new DatabricksVolumeAssetStore({
      host: environment.DATABRICKS_HOST ?? "",
      volumePath: environment.DATABRICKS_VOLUME_PATH ?? "",
      fetch: options.fetch,
      ...(hasStaticToken ? { token: staticToken ?? "" } : hasClientId && hasClientSecret ? {
        tokenProvider: new DatabricksOAuthM2MTokenProvider({
          host: environment.DATABRICKS_HOST ?? "",
          clientId: clientId ?? "",
          clientSecret: clientSecret ?? "",
          fetch: options.fetch,
        }),
      } : {}),
    });
  }
  throw new AssetStoreError("configuration", "STORYVERSE_ASSET_STORAGE must be local or databricks.");
}
