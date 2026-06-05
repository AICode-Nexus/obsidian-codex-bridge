import { describe, expect, it } from "vitest";
import { extractUpdatedNoteFromSuggestion } from "../src/suggestions";

describe("extractUpdatedNoteFromSuggestion", () => {
  it("extracts the updated note from a fenced markdown block", () => {
    const suggestion = [
      "Summary",
      "",
      "```markdown updated-note",
      "# Title",
      "",
      "Better body.",
      "```"
    ].join("\n");

    expect(extractUpdatedNoteFromSuggestion(suggestion)).toBe("# Title\n\nBetter body.");
  });

  it("preserves inner code fences when the outer updated-note fence is longer", () => {
    const suggestion = [
      "````markdown updated-note",
      "# Title",
      "",
      "```ts",
      "console.log('inner');",
      "```",
      "````"
    ].join("\n");

    expect(extractUpdatedNoteFromSuggestion(suggestion)).toBe(
      "# Title\n\n```ts\nconsole.log('inner');\n```"
    );
  });

  it("accepts apostrophe-like fences emitted by local agents", () => {
    const suggestion = [
      "'''markdown updated-note",
      "# Test Note",
      "",
      "Better body.",
      "'''"
    ].join("\n");

    expect(extractUpdatedNoteFromSuggestion(suggestion)).toBe("# Test Note\n\nBetter body.");
  });

  it("returns null when no full-note rewrite is present", () => {
    expect(extractUpdatedNoteFromSuggestion("Only a few bullet suggestions")).toBeNull();
  });
});
