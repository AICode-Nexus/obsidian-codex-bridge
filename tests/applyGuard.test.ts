import { describe, expect, it } from "vitest";
import { canApplySuggestedEdit } from "../src/applyGuard";

describe("canApplySuggestedEdit", () => {
  it("allows apply when the note has not changed", () => {
    expect(canApplySuggestedEdit({ original: "a", current: "a" })).toEqual({ ok: true });
  });

  it("blocks apply when the note changed after suggestion generation", () => {
    expect(canApplySuggestedEdit({ original: "a", current: "b" })).toMatchObject({ ok: false });
  });
});
