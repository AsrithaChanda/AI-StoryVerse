export type StoryCharacter = { id: string; name: string; role: string; visualDescription: string; personality: string; goal: string; memories: string[]; /** Optional while legacy persisted casts are upgraded on read. */ introducedInChapter?: string };
export type StoryBeat = { id: string; description: string; caption: string };
export type StoryAudioDirection = { primaryEmotion: "reflection" | "suspense" | "danger" | "conflict" | "grief" | "triumph"; secondaryEmotion: "reflection" | "suspense" | "danger" | "conflict" | "grief" | "triumph"; intensity: number; bgmCue: "reflection" | "suspense" | "danger" | "conflict" | "grief" | "triumph"; narrationDelivery: string };
export type StoryChapter = { id: string; number: number; title: string; narration: string; beats: StoryBeat[]; audioDirection?: StoryAudioDirection; command?: string; revision?: number };
export type Perspective = { characterId: string; chapterId: string; narration: string; beats: StoryBeat[] };
/** Optional while existing persisted stories are upgraded by the server. */
export type WorldStory = { worldId: string; characters: StoryCharacter[]; chapters: StoryChapter[]; perspectives: Perspective[]; worldState: string; source: "openai" | "fallback"; createdAt: string; updatedAt: string; upcomingDirections?: string[] };
export type ChapterRollbackResult = { story: WorldStory; chapter: StoryChapter };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "The story engine could not complete that request.");
  return payload;
}

export const bootstrapStory = (worldId: string) => request<{ story: WorldStory }>(`/api/worlds/${encodeURIComponent(worldId)}/story/bootstrap`, { method: "POST", body: "{}" });
export const nextChapter = (worldId: string) => request<{ story: WorldStory }>(`/api/worlds/${encodeURIComponent(worldId)}/story/next`, { method: "POST", body: "{}" });
export const commandStory = (worldId: string, command: string) => request<{ story: WorldStory }>(`/api/worlds/${encodeURIComponent(worldId)}/story/command`, { method: "POST", body: JSON.stringify({ command }) });
export const characterPerspective = (worldId: string, characterId: string) => request<{ story: WorldStory; perspective: Perspective }>(`/api/worlds/${encodeURIComponent(worldId)}/story/perspective`, { method: "POST", body: JSON.stringify({ characterId }) });
export const addUpcomingDirection = (worldId: string, direction: string) => request<{ story: WorldStory }>(`/api/worlds/${encodeURIComponent(worldId)}/story/directions`, { method: "POST", body: JSON.stringify({ direction }) });
export const reviseChapter = (worldId: string, prompt: string) => request<{ story: WorldStory; chapter: StoryChapter }>(`/api/worlds/${encodeURIComponent(worldId)}/story/revise`, { method: "POST", body: JSON.stringify({ prompt }) });
export const deleteLatestChapter = (worldId: string, chapterId: string) => request<ChapterRollbackResult>(`/api/worlds/${encodeURIComponent(worldId)}/story/chapters/${encodeURIComponent(chapterId)}`, { method: "DELETE" });
export const deleteFutureChapters = (worldId: string, chapterId: string) => request<ChapterRollbackResult>(`/api/worlds/${encodeURIComponent(worldId)}/story/chapters/${encodeURIComponent(chapterId)}/future`, { method: "DELETE" });
