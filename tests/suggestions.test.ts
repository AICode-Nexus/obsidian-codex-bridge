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

  it("returns null when no full-note rewrite is present", () => {
    expect(extractUpdatedNoteFromSuggestion("Only a few bullet suggestions")).toBeNull();
  });
});
