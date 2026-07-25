const WORLD_QUERY_KEY = "world";

export function worldIdFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get(WORLD_QUERY_KEY)?.trim();
  return value || null;
}

export function worldRoute(location: Pick<Location, "pathname" | "search" | "hash">, worldId: string | null): string {
  const query = new URLSearchParams(location.search);
  if (worldId) query.set(WORLD_QUERY_KEY, worldId);
  else query.delete(WORLD_QUERY_KEY);
  const search = query.toString();
  return `${location.pathname}${search ? `?${search}` : ""}${location.hash}`;
}
