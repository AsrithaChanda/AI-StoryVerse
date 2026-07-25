import { AssetStoreError } from "./types.js";

const safeSegment = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Keys deliberately support a small, portable filename alphabet. Apart from
 * keeping local paths safe, this prevents encoded separators from changing a
 * Databricks Files API path after URL parsing.
 */
export function assetKeySegments(key: string): string[] {
  if (typeof key !== "string" || key.length === 0 || key.length > 1024 || key !== key.trim()) {
    throw new AssetStoreError("invalid_key", "Asset key must be a non-empty relative path.");
  }
  if (key.startsWith("/") || key.includes("\\") || key.includes("\0")) {
    throw new AssetStoreError("invalid_key", "Asset key contains an unsafe path separator.");
  }
  const segments = key.split("/");
  if (segments.length === 0 || segments.some((segment) => !safeSegment.test(segment) || segment === "." || segment === "..")) {
    throw new AssetStoreError("invalid_key", "Asset key contains an unsafe path segment.");
  }
  return segments;
}

export function validatedContentType(contentType: string): string {
  const value = typeof contentType === "string" ? contentType.trim() : "";
  // Reject control characters before using the value in a request header.
  if (!value || value.length > 255 || /[\r\n\0]/.test(value) || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+(?:\s*;\s*[!#$%&'*+.^_`|~0-9A-Za-z-]+(?:=[!#$%&'*+.^_`|~0-9A-Za-z.-]+)?)?$/.test(value)) {
    throw new AssetStoreError("invalid_key", "Asset content type is invalid.");
  }
  return value;
}

export function contentTypeForKey(key: string): string {
  const extension = key.split(".").at(-1)?.toLowerCase();
  return ({
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    svg: "image/svg+xml",
    wav: "audio/wav",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
  })[extension ?? ""] ?? "application/octet-stream";
}

export function volumePathSegments(volumePath: string): string[] {
  if (typeof volumePath !== "string" || volumePath.length === 0 || volumePath !== volumePath.trim() || !volumePath.startsWith("/Volumes/")) {
    throw new AssetStoreError("configuration", "DATABRICKS_VOLUME_PATH must be an absolute Unity Catalog Volume path.");
  }
  if (volumePath.includes("\\") || volumePath.includes("\0")) {
    throw new AssetStoreError("configuration", "DATABRICKS_VOLUME_PATH contains an unsafe path separator.");
  }
  const segments = volumePath.replace(/\/+$/, "").split("/").slice(1);
  if (segments.length < 4 || segments[0] !== "Volumes" || segments.some((segment) => !safeSegment.test(segment) || segment === "." || segment === "..")) {
    throw new AssetStoreError("configuration", "DATABRICKS_VOLUME_PATH must name a catalog, schema, and volume.");
  }
  return segments;
}
