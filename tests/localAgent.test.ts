import { describe, expect, it } from "vitest";
import { buildLocalAgentPrompt, resolveLocalAgentCommand, splitCommandArgs } from "../src/localAgent";
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
      task: "Organize this"
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
