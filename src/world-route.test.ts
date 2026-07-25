import { describe, expect, it } from "vitest";
import { worldIdFromSearch, worldRoute } from "./world-route";

describe("world routes", () => {
  it("reads the requested world from a shareable URL", () => {
    expect(worldIdFromSearch("?world=verdant-archive-debee1b8")).toBe("verdant-archive-debee1b8");
    expect(worldIdFromSearch("?genre=epic&world=bahubali-5693e092")).toBe("bahubali-5693e092");
    expect(worldIdFromSearch("?world=%20%20")).toBeNull();
  });

  it("adds and removes only the world selection while preserving other URL state", () => {
    const current = { pathname: "/", search: "?mode=reader", hash: "#chapter" } as Pick<Location, "pathname" | "search" | "hash">;
    expect(worldRoute(current, "bahubali-5693e092")).toBe("/?mode=reader&world=bahubali-5693e092#chapter");
    expect(worldRoute({ ...current, search: "?mode=reader&world=bahubali-5693e092" }, null)).toBe("/?mode=reader#chapter");
  });
});
