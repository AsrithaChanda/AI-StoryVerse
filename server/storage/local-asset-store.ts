import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { assetKeySegments, contentTypeForKey, validatedContentType } from "./validation.js";
import { AssetStoreError, type AssetStore, type StoredAsset } from "./types.js";

/** A filesystem implementation intended for local development and tests. */
export class LocalAssetStore implements AssetStore {
  private readonly rootDirectory: string;

  public constructor(directory = resolve(process.cwd(), "data", "story-assets")) {
    this.rootDirectory = resolve(directory);
  }

  public async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    validatedContentType(contentType);
    const output = this.pathFor(key);
    const temporary = `${output}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(output), { recursive: true });
      await writeFile(temporary, bytes);
      await rename(temporary, output);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      if (error instanceof AssetStoreError) throw error;
      throw new AssetStoreError("local_error", "Could not save the generated asset.");
    }
  }

  public async exists(key: string): Promise<boolean> {
    const path = this.pathFor(key);
    try {
      await access(path, constants.F_OK);
      return (await stat(path)).isFile();
    } catch (error) {
      if (isNotFound(error)) return false;
      throw new AssetStoreError("local_error", "Could not inspect the generated asset.");
    }
  }

  public async read(key: string): Promise<StoredAsset | null> {
    const path = this.pathFor(key);
    try {
      const bytes = new Uint8Array(await readFile(path));
      return { bytes, contentType: contentTypeForKey(key) };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new AssetStoreError("local_error", "Could not read the generated asset.");
    }
  }

  private pathFor(key: string): string {
    const path = resolve(this.rootDirectory, ...assetKeySegments(key));
    // Keep this guard even though assetKeySegments already rejects traversal.
    const pathFromRoot = relative(this.rootDirectory, path);
    if (pathFromRoot === "" || pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === "..") {
      throw new AssetStoreError("invalid_key", "Asset key resolves outside the configured asset directory.");
    }
    return path;
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
