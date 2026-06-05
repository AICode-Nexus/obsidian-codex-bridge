import { describe, expect, it } from "vitest";
import {
  buildLocalAgentEnv,
  buildLocalAgentPrompt,
  resolveExecutableCommand,
  resolveLocalAgentCommand,
  splitCommandArgs
} from "../src/localAgent";
import { DEFAULT_SETTINGS } from "../src/settings";

describe("splitCommandArgs", () => {
  it("keeps quoted arguments together", () => {
    expect(splitCommandArgs('exec --cd "{{vaultPath}}" --sandbox danger-full-access -')).toEqual([
      "exec",
      "--cd",
      "{{vaultPath}}",
      "--sandbox",
      "danger-full-access",
      "-"
    ]);
  });
});

describe("resolveLocalAgentCommand", () => {
  it("injects vault and note paths while passing the task through stdin", () => {
    const command = resolveLocalAgentCommand({
      settings: {
        ...DEFAULT_SETTINGS,
        localCommand: "codex",
        localArgs: 'exec --cd "{{vaultPath}}" --sandbox danger-full-access --ask-for-approval never -'
      },
      vaultPath: "/Users/me/Vault",
      notePath: "inbox.md",
      noteContent: "raw idea",
      task: "Organize this",
      executableResolver: {
        candidatePaths: [],
        exists: () => false
      }
    });

    expect(command.command).toBe("codex");
    expect(command.args).toContain("/Users/me/Vault");
    expect(command.args).toContain("danger-full-access");
    expect(command.args).toContain("never");
    expect(command.stdin).toContain("Organize this");
    expect(command.stdin).toContain("inbox.md");
    expect(command.cwd).toBe("/Users/me/Vault");
  });
});

describe("resolveExecutableCommand", () => {
  it("uses an existing absolute candidate when a GUI-launched app cannot find codex on PATH", () => {
    expect(
      resolveExecutableCommand("codex", {
        candidatePaths: ["/missing/codex", "/Users/admin/.nvm/versions/node/v24.15.0/bin/codex"],
        exists: (path) => path.includes("v24.15.0")
      })
    ).toBe("/Users/admin/.nvm/versions/node/v24.15.0/bin/codex");
  });

  it("keeps custom absolute commands untouched", () => {
    expect(
      resolveExecutableCommand("/opt/bin/custom-agent", {
        candidatePaths: ["/Users/admin/.nvm/versions/node/v24.15.0/bin/codex"],
        exists: () => true
      })
    ).toBe("/opt/bin/custom-agent");
  });
});

describe("buildLocalAgentEnv", () => {
  it("adds the resolved executable directory to PATH so /usr/bin/env can find node", () => {
    const env = buildLocalAgentEnv({
      baseEnv: { HOME: "/Users/admin" },
      command: "/Users/admin/.nvm/versions/node/v24.15.0/bin/codex"
    });

    expect(env.PATH?.split(":")).toContain("/Users/admin/.nvm/versions/node/v24.15.0/bin");
    expect(env.PATH?.split(":")).toContain("/usr/bin");
    expect(env.PATH?.split(":")).toContain("/bin");
  });

  it("preserves an existing PATH while prepending required GUI-safe directories", () => {
    const env = buildLocalAgentEnv({
      baseEnv: { PATH: "/custom/bin", HOME: "/Users/admin" },
      command: "/Users/admin/.nvm/versions/node/v24.15.0/bin/codex"
    });

    expect(env.PATH?.startsWith("/Users/admin/.nvm/versions/node/v24.15.0/bin:")).toBe(true);
    expect(env.PATH?.split(":")).toContain("/custom/bin");
  });
});

describe("buildLocalAgentPrompt", () => {
  it("preserves AGENTS-style instructions and current note content", () => {
    const prompt = buildLocalAgentPrompt({
      task: "Improve the note",
      notePath: "20-notes/agent.md",
      noteContent: "Draft",
      vaultInstructions: "Do not publish unless publish: true."
    });

    expect(prompt).toContain("Improve the note");
    expect(prompt).toContain("20-notes/agent.md");
    expect(prompt).toContain("Do not publish unless publish: true.");
    expect(prompt).toContain("Draft");
  });
});
