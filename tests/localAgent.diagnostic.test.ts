import { describe, expect, it } from "vitest";
import { buildLocalAgentEnv } from "../src/localAgent";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/settings";

describe("local backend diagnostic assumptions", () => {
  it("normalizes stale settings before diagnostics run", () => {
    const settings = normalizeSettings({
      localArgs: 'exec --cd "{{vaultPath}}" --sandbox danger-full-access --ask-for-approval never -'
    });

    expect(settings.localArgs).toContain("--skip-git-repo-check");
    expect(settings.localArgs).not.toContain("--ask-for-approval");
  });

  it("diagnostic PATH includes enough system paths for GUI-launched Obsidian", () => {
    const env = buildLocalAgentEnv({
      baseEnv: { HOME: "/Users/admin" },
      command: "/Users/admin/.nvm/versions/node/v24.15.0/bin/codex"
    });

    expect(env.PATH).toContain("/Users/admin/.nvm/versions/node/v24.15.0/bin");
    expect(env.PATH).toContain("/usr/bin");
  });

  it("default settings are configured for a non-git test vault", () => {
    expect(DEFAULT_SETTINGS.localArgs).toContain("--skip-git-repo-check");
  });
});
