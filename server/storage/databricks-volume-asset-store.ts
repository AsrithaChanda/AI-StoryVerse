import { assetKeySegments, contentTypeForKey, validatedContentType, volumePathSegments } from "./validation.js";
import { AssetStoreError, type AssetStore, type StoredAsset } from "./types.js";

export type DatabricksFetch = typeof globalThis.fetch;

export type DatabricksVolumeAssetStoreOptions = {
  host: string;
  token: string;
  volumePath: string;
  fetch?: DatabricksFetch;
};

/**
 * Generated-media storage backed by the Databricks Files REST API and a Unity
 * Catalog Volume. The API uses raw byte bodies; it never exposes the token in
 * a URL or an error message.
 */
export class DatabricksVolumeAssetStore implements AssetStore {
  private readonly origin: string;
  private readonly token: string;
  private readonly volumeSegments: string[];
  private readonly fetcher: DatabricksFetch;

  public constructor(options: DatabricksVolumeAssetStoreOptions) {
    this.origin = databricksOrigin(options.host);
    this.token = databricksToken(options.token);
    this.volumeSegments = volumePathSegments(options.volumePath);
    this.fetcher = options.fetch ?? globalThis.fetch;
    if (typeof this.fetcher !== "function") throw new AssetStoreError("configuration", "A fetch implementation is required for Databricks asset storage.");
  }

  public async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const response = await this.request(key, "PUT", {
      body: rawByteBody(bytes),
      headers: { "Content-Type": validatedContentType(contentType) },
    }, true);
    this.requireSuccess(response);
  }

  public async exists(key: string): Promise<boolean> {
    const response = await this.request(key, "HEAD");
    if (response.status === 404) return false;
    this.requireSuccess(response);
    return true;
  }

  public async read(key: string): Promise<StoredAsset | null> {
    const response = await this.request(key, "GET");
    if (response.status === 404) return null;
    this.requireSuccess(response);
    try {
      const bytes = new Uint8Array(await response.arrayBuffer());
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() || contentTypeForKey(key);
      return { bytes, contentType };
    } catch {
      throw new AssetStoreError("provider_error", "Databricks asset storage returned an unreadable asset.");
    }
  }

  private async request(key: string, method: "GET" | "HEAD" | "PUT", init: Pick<RequestInit, "body" | "headers"> = {}, overwrite = false): Promise<Response> {
    const url = this.fileUrl(key, overwrite);
    try {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${this.token}`);
      return await this.fetcher(url, {
        method,
        headers,
        body: init.body,
      });
    } catch {
      throw new AssetStoreError("provider_error", "Databricks asset storage request failed.");
    }
  }

  private fileUrl(key: string, overwrite: boolean): URL {
    const encodedPath = [...this.volumeSegments, ...assetKeySegments(key)].map((segment) => encodeURIComponent(segment)).join("/");
    const url = new URL(`/api/2.0/fs/files/${encodedPath}`, this.origin);
    if (overwrite) url.searchParams.set("overwrite", "true");
    return url;
  }

  private requireSuccess(response: Response): void {
    if (!response.ok) throw new AssetStoreError("provider_error", `Databricks asset storage request failed with status ${response.status}.`, response.status);
  }
}

function databricksOrigin(host: string): string {
  const value = typeof host === "string" ? host.trim() : "";
  if (!value || /[\r\n\0]/.test(value)) throw new AssetStoreError("configuration", "DATABRICKS_HOST must be a Databricks workspace host.");
  let url: URL;
  try {
    url = new URL(/^https:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    throw new AssetStoreError("configuration", "DATABRICKS_HOST must be a valid HTTPS URL or hostname.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new AssetStoreError("configuration", "DATABRICKS_HOST must contain only an HTTPS workspace origin.");
  }
  return url.origin;
}

function databricksToken(token: string): string {
  const value = typeof token === "string" ? token.trim() : "";
  if (!value || value !== token || value.length > 8192 || /[\r\n\0]/.test(value)) {
    throw new AssetStoreError("configuration", "DATABRICKS_TOKEN must be a non-empty token without whitespace around it.");
  }
  return value;
}

/** Copy into a concrete ArrayBuffer so Fetch transmits precisely the bytes. */
function rawByteBody(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
