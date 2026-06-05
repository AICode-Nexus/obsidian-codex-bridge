import { describe, expect, it } from "vitest";
import { resolveCurrentMarkdownFile, type MarkdownFileLike } from "../src/currentNote";

describe("resolveCurrentMarkdownFile", () => {
  it("uses the active markdown file when available", () => {
    const active: MarkdownFileLike = { extension: "md", path: "notes/active.md" };
    const fallback: MarkdownFileLike = { extension: "md", path: "notes/fallback.md" };

    expect(resolveCurrentMarkdownFile(active, fallback)).toBe(active);
  });

  it("falls back to the last markdown file when the plugin panel is active", () => {
    const fallback: MarkdownFileLike = { extension: "md", path: "notes/fallback.md" };

    expect(resolveCurrentMarkdownFile(null, fallback)).toBe(fallback);
  });

  it("does not use non-markdown fallbacks", () => {
    const fallback: MarkdownFileLike = { extension: "canvas", path: "board.canvas" };

    expect(resolveCurrentMarkdownFile(null, fallback)).toBeNull();
  });
});
