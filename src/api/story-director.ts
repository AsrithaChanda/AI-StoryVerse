import type { StoryChapter, WorldStory } from "./story";

export type DirectorChange = {
  category: "pacing" | "characterization" | "foreshadowing" | "tone" | "imagery" | "scene_order";
  summary: string;
  rationale: string;
  affectedBeatIds: string[];
};

export type ChapterDirectorProposal = {
  chapterId: string;
  baseRevision: number;
  directive: string;
  directorIntent: string;
  changes: DirectorChange[];
  proposedChapter: StoryChapter;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "The story engine could not complete that request.");
  return payload;
}

export function proposeChapterDirection(
  worldId: string,
  chapterId: string,
  prompt: string,
): Promise<{ proposal: ChapterDirectorProposal }> {
  return request<{ proposal: ChapterDirectorProposal }>(
    `/api/worlds/${encodeURIComponent(worldId)}/story/chapters/${encodeURIComponent(chapterId)}/director/propose`,
    { method: "POST", body: JSON.stringify({ prompt }) },
  );
}

export function applyChapterDirection(
  worldId: string,
  chapterId: string,
  proposal: ChapterDirectorProposal,
): Promise<{ story: WorldStory; chapter: StoryChapter }> {
  return request<{ story: WorldStory; chapter: StoryChapter }>(
    `/api/worlds/${encodeURIComponent(worldId)}/story/chapters/${encodeURIComponent(chapterId)}/director/apply`,
    { method: "POST", body: JSON.stringify({ proposal }) },
  );
}
