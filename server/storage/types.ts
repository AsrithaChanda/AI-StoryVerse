/**
 * A provider-neutral store for generated media. Keys are logical, relative
 * paths such as `images/world-123/cover.png`; callers never supply a host or
 * a filesystem path.
 */
export interface AssetStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  read(key: string): Promise<StoredAsset | null>;
}

export type StoredAsset = {
  bytes: Uint8Array;
  contentType: string;
};

export type AssetStoreErrorCode = "configuration" | "invalid_key" | "local_error" | "provider_error";

/** Intentionally contains no provider response body, URL, or credential. */
export class AssetStoreError extends Error {
  public constructor(
    public readonly code: AssetStoreErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AssetStoreError";
  }
}
