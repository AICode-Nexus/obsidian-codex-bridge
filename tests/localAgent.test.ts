import { describe, expect, it } from "vitest";
import {
  appendBoundedOutput,
  buildLocalAgentEnv,
  buildLocalAgentPrompt,
  expandCodexCandidates,
  getLocalAgentOutput,
  resolveExecutableCommand,
  resolveLocalAgentCommand,
  splitCommandArgs
} from "../src/localAgent";
import { DEFAULT_SETTINGS, LEGACY_LOCAL_ARGS, normalizeSettings } from "../src/settings";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

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
        localArgs:
          'exec --cd "{{vaultPath}}" --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --output-last-message "{{outputFile}}" -'
      },
      vaultPath: "/Users/me/Vault",
      notePath: "inbox.md",
      noteContent: "raw idea",
      task: "Organize this",
      outputFilePath: "/tmp/codex-last-message.txt",
      executableResolver: {
        candidatePaths: [],
        exists: () => false
      }
    });

    expect(command.command).toBe("codex");
    expect(command.args).toContain("/Users/me/Vault");
    expect(command.args).toContain("--skip-git-repo-check");
    expect(command.args).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(command.args).toContain("/tmp/codex-last-message.txt");
    expect(command.stdin).toContain("Organize this");
    expect(command.stdin).toContain("inbox.md");
    expect(command.cwd).toBe("/Users/me/Vault");
  });
});

describe("recommended local args", () => {
  it("match current codex exec flags for non-git Obsidian vaults", () => {
    expect(DEFAULT_SETTINGS.localArgs).toContain("--skip-git-repo-check");
    expect(DEFAULT_SETTINGS.localArgs).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(DEFAULT_SETTINGS.localArgs).toContain("--output-last-message");
    expect(DEFAULT_SETTINGS.localArgs).toContain("{{outputFile}}");
    expect(DEFAULT_SETTINGS.localArgs).not.toContain("--ask-for-approval");
  });

  it("migrates the legacy local args that current codex exec rejects", () => {
    expect(normalizeSettings({ localArgs: LEGACY_LOCAL_ARGS }).localArgs).toBe(
      DEFAULT_SETTINGS.localArgs
    );
  });
});

describe("local execution safety settings", () => {
  it("has a bounded default timeout", () => {
    expect(DEFAULT_SETTINGS.localTimeoutMs).toBeGreaterThan(0);
  });

  it("caps buffered output", () => {
    expect(appendBoundedOutput("abcdef", "gh", 5)).toBe("defgh");
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

describe("expandCodexCandidates", () => {
  it("discovers node manager version directories", () => {
    const root = `${tmpdir()}/codex-bridge-candidates-${Date.now()}`;
    mkdirSync(`${root}/v20.0.0/bin`, { recursive: true });
    mkdirSync(`${root}/v24.15.0/bin`, { recursive: true });

    try {
      expect(expandCodexCandidates(root)).toEqual([
        `${root}/v20.0.0/bin/codex`,
        `${root}/v24.15.0/bin/codex`
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
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

describe("getLocalAgentOutput", () => {
  it("prefers the final response file over noisy codex stdout", () => {
    expect(
      getLocalAgentOutput({
        stdout: "OpenAI Codex\\n--------\\ncodex\\nOK\\ntokens used",
        outputFileText: "OK"
      })
    ).toBe("OK");
  });

  it("falls back to stdout when no final response file is present", () => {
    expect(getLocalAgentOutput({ stdout: "plain result", outputFileText: "" })).toBe("plain result");
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
