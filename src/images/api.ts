import type { StoryImage } from "./contracts";
import type { SceneImageRequest } from "../components/SceneImage";
import type { WorldCoverRequest } from "../components/WorldImage";

type ImageResponse = { image: StoryImage };

async function imageRequest(path: string, init?: RequestInit): Promise<StoryImage | null> {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
  if (response.status === 404) return null;
  const payload = await response.json().catch(() => null) as ImageResponse | null;
  // A 502 deliberately includes the durable failed record so the UI can show
  // the instant fallback and offer the explicit guarded retry control.
  if (payload?.image && (response.ok || response.status === 502)) return payload.image;
  throw new Error("Image request failed");
}

function sceneId(request: SceneImageRequest): string {
  return request.sceneId ?? `${request.moment}-${request.branchId ?? "root"}`;
}

export function loadSceneImage(request: SceneImageRequest): Promise<StoryImage | null> {
  const query = new URLSearchParams({ worldId: request.worldId });
  if (request.branchId) query.set("branchId", request.branchId);
  if (request.protagonistId) query.set("protagonistId", request.protagonistId);
  return imageRequest(`/api/images/${sceneId(request)}?${query.toString()}`);
}

export function generateSceneImage(request: SceneImageRequest, retry = false): Promise<StoryImage | null> {
  return imageRequest("/api/images/generate", { method: "POST", body: JSON.stringify({ ...request, sceneId: sceneId(request), retry }) });
}

export function loadWorldCover(request: WorldCoverRequest): Promise<StoryImage | null> {
  return imageRequest(`/api/images/world-cover?worldId=${encodeURIComponent(request.worldId)}`);
}

export function generateWorldCover(request: WorldCoverRequest, retry = false): Promise<StoryImage | null> {
  return imageRequest(`/api/worlds/${encodeURIComponent(request.worldId)}/cover`, { method: "POST", body: JSON.stringify({ retry }) });
}
