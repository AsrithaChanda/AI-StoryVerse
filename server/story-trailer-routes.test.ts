import { describe, expect, it } from "vitest";
import { parseByteRange } from "./story-trailer-routes.js";

describe("story trailer byte ranges", () => {
  it("supports full-tail, bounded, and suffix requests", () => {
    expect(parseByteRange("bytes=250-", 1_000)).toEqual({ start: 250, end: 999 });
    expect(parseByteRange("bytes=100-299", 1_000)).toEqual({ start: 100, end: 299 });
    expect(parseByteRange("bytes=-200", 1_000)).toEqual({ start: 800, end: 999 });
    expect(parseByteRange("bytes=900-1500", 1_000)).toEqual({ start: 900, end: 999 });
  });

  it("rejects malformed or unsatisfiable ranges", () => {
    expect(parseByteRange("items=0-2", 1_000)).toBeNull();
    expect(parseByteRange("bytes=1000-", 1_000)).toBeNull();
    expect(parseByteRange("bytes=300-100", 1_000)).toBeNull();
    expect(parseByteRange("bytes=-0", 1_000)).toBeNull();
    expect(parseByteRange("bytes=0-1,4-5", 1_000)).toBeNull();
  });
});
