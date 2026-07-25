import { assetKeySegments, contentTypeForKey, validatedContentType, volumePathSegments } from "./validation.js";
import { AssetStoreError, type AssetStore, type StoredAsset } from "./types.js";

export type DatabricksFetch = typeof globalThis.fetch;

/** A bearer-token source is deliberately small so the Files API client never
 * needs to know whether it is using a short-lived OAuth token or a PAT. */
export type DatabricksAccessTokenProvider = {
  getAccessToken(): Promise<string>;
  invalidate?(): void;
};

export type OAuthM2MTokenProviderOptions = {
  host: string;
  clientId: string;
  clientSecret: string;
  fetch?: DatabricksFetch;
  /** Test-only injection; normal workspace auth uses `${host}/oidc/v1/token`. */
  tokenUrl?: string;
  now?: () => number;
  refreshSkewMs?: number;
};

export type DatabricksVolumeAssetStoreOptions = {
  host: string;
  volumePath: string;
  /** Backward-compatible static PAT/OAuth bearer token configuration. */
  token?: string;
  /** Preferred production path: cached OAuth M2M tokens from client credentials. */
  tokenProvider?: DatabricksAccessTokenProvider;
  fetch?: DatabricksFetch;
};

/** Use a supplied PAT or another externally managed bearer token. */
export class StaticDatabricksTokenProvider implements DatabricksAccessTokenProvider {
  private readonly token: string;

  public constructor(token: string) {
    this.token = databricksToken(token, "DATABRICKS_TOKEN");
  }

  public async getAccessToken(): Promise<string> {
    return this.token;
  }
}

/**
 * OAuth client-credentials provider for a Databricks workspace. It caches the
 * workspace token until shortly before expiry and coalesces concurrent refresh
 * requests, so a burst of image uploads cannot request one token per file.
 */
export class DatabricksOAuthM2MTokenProvider implements DatabricksAccessTokenProvider {
  private readonly tokenUrl: URL;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetcher: DatabricksFetch;
  private readonly now: () => number;
  private readonly refreshSkewMs: number;
  private cached: { value: string; expiresAt: number } | undefined;
  private refreshing: Promise<string> | undefined;

  public constructor(options: OAuthM2MTokenProviderOptions) {
    const origin = databricksOrigin(options.host);
    this.tokenUrl = options.tokenUrl ? oauthTokenUrl(options.tokenUrl) : new URL("/oidc/v1/token", origin);
    this.clientId = databricksToken(options.clientId, "DATABRICKS_CLIENT_ID");
    this.clientSecret = databricksToken(options.clientSecret, "DATABRICKS_CLIENT_SECRET");
    this.fetcher = options.fetch ?? globalThis.fetch;
    if (typeof this.fetcher !== "function") throw new AssetStoreError("configuration", "A fetch implementation is required for Databricks OAuth authentication.");
    this.now = options.now ?? Date.now;
    this.refreshSkewMs = Math.max(15_000, options.refreshSkewMs ?? 60_000);
  }

  public async getAccessToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt > this.now()) return this.cached.value;
    if (!this.refreshing) {
      this.refreshing = this.requestToken().finally(() => { this.refreshing = undefined; });
    }
    return this.refreshing;
  }

  public invalidate(): void {
    this.cached = undefined;
  }

  private async requestToken(): Promise<string> {
    let response: Response;
    try {
      response = await this.fetcher(this.tokenUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`, "utf8").toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ grant_type: "client_credentials", scope: "all-apis" }),
      });
    } catch {
      throw new AssetStoreError("provider_error", "Databricks OAuth token request failed.");
    }
    if (!response.ok) throw new AssetStoreError("provider_error", `Databricks OAuth token request failed with status ${response.status}.`, response.status);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new AssetStoreError("provider_error", "Databricks OAuth token response was invalid.");
    }
    const payload = body as { access_token?: unknown; expires_in?: unknown };
    const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
    const expiresIn = typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in) ? payload.expires_in : 3600;
    if (!accessToken || accessToken.length > 16_384 || /[\r\n\0]/.test(accessToken)) {
      throw new AssetStoreError("provider_error", "Databricks OAuth token response did not include a valid access token.");
    }
    // Cache for nearly all of the server-provided lifetime, but never spin on
    // very short test tokens or an unexpectedly low expires_in value.
    const usableLifetime = Math.max(1_000, expiresIn * 1_000 - this.refreshSkewMs);
    this.cached = { value: accessToken, expiresAt: this.now() + usableLifetime };
    return accessToken;
  }
}

/**
 * Generated-media storage backed by the Databricks Files REST API and a Unity
 * Catalog Volume. It accepts either a static token or a refreshable OAuth M2M
 * provider; neither credential is exposed in storage keys, URLs, or errors.
 */
export class DatabricksVolumeAssetStore implements AssetStore {
  private readonly origin: string;
  private readonly volumeSegments: string[];
  private readonly fetcher: DatabricksFetch;
  private readonly tokenProvider: DatabricksAccessTokenProvider;

  public constructor(options: DatabricksVolumeAssetStoreOptions) {
    this.origin = databricksOrigin(options.host);
    this.volumeSegments = volumePathSegments(options.volumePath);
    this.fetcher = options.fetch ?? globalThis.fetch;
    if (typeof this.fetcher !== "function") throw new AssetStoreError("configuration", "A fetch implementation is required for Databricks asset storage.");
    this.tokenProvider = options.tokenProvider ?? (options.token ? new StaticDatabricksTokenProvider(options.token) : missingTokenProvider());
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
      const response = await this.requestWithCurrentToken(url, method, init);
      // An OAuth token can be revoked early. Retry exactly once after an
      // invalidation; static PATs deliberately do not create a second call.
      if (response.status !== 401 || !this.tokenProvider.invalidate) return response;
      this.tokenProvider.invalidate();
      return this.requestWithCurrentToken(url, method, init);
    } catch (error) {
      if (error instanceof AssetStoreError) throw error;
      throw new AssetStoreError("provider_error", "Databricks asset storage request failed.");
    }
  }

  private async requestWithCurrentToken(url: URL, method: "GET" | "HEAD" | "PUT", init: Pick<RequestInit, "body" | "headers">): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${await this.tokenProvider.getAccessToken()}`);
    return this.fetcher(url, { method, headers, body: init.body });
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

export function databricksOrigin(host: string): string {
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

function oauthTokenUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AssetStoreError("configuration", "Databricks OAuth token URL must be a valid HTTPS URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new AssetStoreError("configuration", "Databricks OAuth token URL must be an HTTPS endpoint without credentials.");
  }
  return url;
}

function databricksToken(value: string, name: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized !== value || normalized.length > 8192 || /[\r\n\0]/.test(normalized)) {
    throw new AssetStoreError("configuration", `${name} must be a non-empty credential without whitespace around it.`);
  }
  return normalized;
}

function missingTokenProvider(): never {
  throw new AssetStoreError("configuration", "Set DATABRICKS_TOKEN or both DATABRICKS_CLIENT_ID and DATABRICKS_CLIENT_SECRET for Databricks asset storage.");
}

/** Copy into a concrete ArrayBuffer so Fetch transmits precisely the bytes. */
function rawByteBody(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
