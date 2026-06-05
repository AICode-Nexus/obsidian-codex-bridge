import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { CodexBridgeSettings } from "./settings";

export interface LocalAgentInput {
  settings: CodexBridgeSettings;
  vaultPath: string;
  notePath: string;
  noteContent: string;
  task: string;
  vaultInstructions?: string;
  executableResolver?: {
    candidatePaths?: string[];
    exists?: (path: string) => boolean;
  };
}

export interface LocalAgentCommand {
  command: string;
  args: string[];
  cwd: string;
  stdin: string;
}

export function splitCommandArgs(value: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "\"" | "'" | null = null;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === '"' || char === "'") && quote === null) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = null;
      continue;
    }
    if (/\s/.test(char) && quote === null) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) {
    args.push(current);
  }

  return args;
}

export function buildLocalAgentPrompt(input: {
  task: string;
  notePath: string;
  noteContent: string;
  vaultInstructions?: string;
}): string {
  return [
    "You are working inside an Obsidian vault.",
    "Respect all repository, vault, and AGENTS.md instructions.",
    "Return concise output suitable for an Obsidian side panel.",
    "",
    `Task: ${input.task}`,
    `Current note path: ${input.notePath}`,
    input.vaultInstructions ? `Vault instructions:\n${input.vaultInstructions}` : "",
    "Current note content:",
    "```markdown",
    input.noteContent,
    "```"
  ]
    .filter(Boolean)
    .join("\n");
}

export function resolveLocalAgentCommand(input: LocalAgentInput): LocalAgentCommand {
  const prompt = buildLocalAgentPrompt(input);
  const replacements = {
    "{{vaultPath}}": input.vaultPath,
    "{{notePath}}": input.notePath
  };
  const args = splitCommandArgs(input.settings.localArgs).map((arg) =>
    Object.entries(replacements).reduce(
      (resolved, [token, value]) => resolved.replaceAll(token, value),
      arg
    )
  );

  return {
    command: resolveExecutableCommand(input.settings.localCommand, input.executableResolver),
    args,
    cwd: input.vaultPath,
    stdin: prompt
  };
}

export function resolveExecutableCommand(
  command: string,
  options: {
    candidatePaths?: string[];
    exists?: (path: string) => boolean;
  } = {}
): string {
  if (command.includes("/")) {
    return command;
  }
  if (command !== "codex") {
    return command;
  }

  const exists = options.exists ?? existsSync;
  const candidatePaths = options.candidatePaths ?? defaultCodexCandidatePaths();
  return candidatePaths.find((candidate) => exists(candidate)) ?? command;
}

function defaultCodexCandidatePaths(): string[] {
  const home = process.env.HOME;
  return [
    process.env.CODEX_BRIDGE_CODEX_PATH,
    home ? `${home}/.nvm/versions/node/v24.15.0/bin/codex` : undefined,
    home ? `${home}/.nvm/versions/node/v24.14.0/bin/codex` : undefined,
    home ? `${home}/.nvm/versions/node/v22.22.3/bin/codex` : undefined,
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex"
  ].filter((path): path is string => Boolean(path));
}

export async function runLocalAgent(input: LocalAgentInput): Promise<string> {
  const command = resolveLocalAgentCommand(input);

  return new Promise((resolve, reject) => {
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || `Local agent exited with code ${code}.`));
      }
    });

    child.stdin.end(command.stdin);
  });
}
