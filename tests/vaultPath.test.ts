import { describe, expect, it } from "vitest";
import { resolveVaultPath } from "../src/vaultPath";

describe("resolveVaultPath", () => {
  it("uses the public getBasePath API when available", () => {
    expect(resolveVaultPath({ getBasePath: () => "/Users/me/Vault" })).toBe("/Users/me/Vault");
  });

  it("falls back to basePath for compatibility", () => {
    expect(resolveVaultPath({ basePath: "/Users/me/LegacyVault" })).toBe("/Users/me/LegacyVault");
  });

  it("returns null instead of falling back to root", () => {
    expect(resolveVaultPath({})).toBeNull();
  });
});
