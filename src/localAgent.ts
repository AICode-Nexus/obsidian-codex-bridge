import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import type { CodexBridgeSettings } from "./settings";

const MAX_BUFFER_CHARS = 200_000;

export interface LocalAgentInput {
  settings: CodexBridgeSettings;
  vaultPath: string;
  notePath: string;
  noteContent: string;
  task: string;
  vaultInstructions?: string;
  outputFilePath?: string;
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

export interface LocalAgentDiagnostic {
  ok: boolean;
  report: string;
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
    "{{notePath}}": input.notePath,
    "{{outputFile}}": input.outputFilePath ?? ""
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

export function getLocalAgentOutput(input: {
  stdout: string;
  outputFileText?: string;
}): string {
  const fromFile = input.outputFileText?.trim();
  return fromFile || input.stdout.trim();
}

export function appendBoundedOutput(value: string, chunk: string, maxChars = MAX_BUFFER_CHARS): string {
  const next = value + chunk;
  return next.length > maxChars ? next.slice(-maxChars) : next;
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

export function buildLocalAgentEnv(input: {
  baseEnv: NodeJS.ProcessEnv;
  command: string;
}): NodeJS.ProcessEnv {
  const pathEntries = [
    input.command.includes("/") ? dirname(input.command) : undefined,
    input.baseEnv.HOME ? `${input.baseEnv.HOME}/.local/bin` : undefined,
    input.baseEnv.HOME ? `${input.baseEnv.HOME}/.nvm/versions/node/v24.15.0/bin` : undefined,
    input.baseEnv.HOME ? `${input.baseEnv.HOME}/.nvm/versions/node/v22.22.3/bin` : undefined,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    input.baseEnv.PATH
  ];

  return {
    ...input.baseEnv,
    PATH: uniquePathEntries(pathEntries).join(":")
  };
}

function uniquePathEntries(entries: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of entries) {
    if (!entry) {
      continue;
    }
    for (const part of entry.split(":")) {
      if (!part || seen.has(part)) {
        continue;
      }
      seen.add(part);
      result.push(part);
    }
  }
  return result;
}

function defaultCodexCandidatePaths(): string[] {
  const home = process.env.HOME;
  return uniquePathEntries([
    process.env.CODEX_BRIDGE_CODEX_PATH,
    home ? `${home}/.nvm/versions/node/v24.15.0/bin/codex` : undefined,
    home ? `${home}/.nvm/versions/node/v24.14.0/bin/codex` : undefined,
    home ? `${home}/.nvm/versions/node/v22.22.3/bin/codex` : undefined,
    ...expandCodexCandidates(home ? `${home}/.nvm/versions/node` : undefined),
    ...expandCodexCandidates(home ? `${home}/.fnm/node-versions` : undefined),
    home ? `${home}/.volta/bin/codex` : undefined,
    home ? `${home}/.asdf/shims/codex` : undefined,
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex"
  ].filter((path): path is string => Boolean(path)));
}

export function expandCodexCandidates(root: string | undefined): string[] {
  if (!root || !existsSync(root)) {
    return [];
  }

  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${root}/${entry.name}/bin/codex`);
  } catch {
    return [];
  }
}

export async function runLocalAgent(input: LocalAgentInput): Promise<string> {
  const outputDir = mkdtempSync(`${tmpdir()}/codex-bridge-`);
  const outputFilePath = `${outputDir}/last-message.txt`;
  const command = resolveLocalAgentCommand({
    ...input,
    outputFilePath
  });

  return new Promise((resolve, reject) => {
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env: buildLocalAgentEnv({
        baseEnv: process.env,
        command: command.command
      }),
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, input.settings.localTimeoutMs);
    child.stdout.on("data", (chunk: string) => {
      stdout = appendBoundedOutput(stdout, chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = appendBoundedOutput(stderr, chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      rmSync(outputDir, { force: true, recursive: true });
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const outputFileText = readOptionalFile(outputFilePath);
      rmSync(outputDir, { force: true, recursive: true });
      if (code === 0) {
        resolve(getLocalAgentOutput({ stdout, outputFileText }));
      } else if (timedOut) {
        reject(new Error(`Local agent timed out after ${input.settings.localTimeoutMs}ms.`));
      } else {
        reject(new Error(stderr.trim() || `Local agent exited with code ${code}.`));
      }
    });

    child.stdin.end(command.stdin);
  });
}

export async function diagnoseLocalAgent(input: {
  settings: CodexBridgeSettings;
  vaultPath: string;
  executableResolver?: LocalAgentInput["executableResolver"];
}): Promise<LocalAgentDiagnostic> {
  const command = resolveExecutableCommand(input.settings.localCommand, input.executableResolver);
  const env = buildLocalAgentEnv({ baseEnv: process.env, command });
  const checks: Array<{ label: string; ok: boolean; detail: string }> = [];

  const version = await runProcess(command, ["--version"], input.vaultPath, env);
  checks.push({
    label: "Executable",
    ok: version.code === 0,
    detail: version.code === 0 ? version.stdout.trim() : version.stderr.trim() || (version.error ?? "")
  });

  const help = await runProcess(command, ["exec", "--help"], input.vaultPath, env);
  checks.push({
    label: "codex exec",
    ok:
      help.code === 0 &&
      help.stdout.includes("--skip-git-repo-check") &&
      help.stdout.includes("--dangerously-bypass-approvals-and-sandbox") &&
      help.stdout.includes("--output-last-message"),
    detail:
      help.code === 0
        ? "Required exec flags are available."
        : help.stderr.trim() || help.error || "Unable to inspect exec help."
  });

  const isGitVault = existsSync(`${input.vaultPath}/.git`);
  const args = input.settings.localArgs;
  checks.push({
    label: "Vault",
    ok: isGitVault || args.includes("--skip-git-repo-check"),
    detail: isGitVault
      ? "Vault is a git repository."
      : "Vault is not a git repository; --skip-git-repo-check is required."
  });
  checks.push({
    label: "Arguments",
    ok:
      !args.includes("--ask-for-approval") &&
      args.includes("--output-last-message") &&
      args.includes("{{outputFile}}"),
    detail: args
  });

  const ok = checks.every((check) => check.ok);
  const report = [
    "# Local backend diagnostics",
    "",
    `Command: ${command}`,
    `Vault: ${input.vaultPath}`,
    `PATH preview: ${pathPreview(env.PATH ?? "")}`,
    "",
    ...checks.map((check) => {
      const mark = check.ok ? "PASS" : "FAIL";
      return `- ${mark} ${check.label}: ${check.detail}`;
    })
  ].join("\n");

  return { ok, report };
}

function pathPreview(path: string): string {
  const entries = path.split(":").filter(Boolean);
  const preview = entries.slice(0, 8).join(":");
  return entries.length > 8 ? `${preview}:...` : preview;
}

async function runProcess(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<{ code: number | null; stdout: string; stderr: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"]
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
    child.on("error", (error) => {
      resolve({ code: null, stdout, stderr, error: error.message });
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function readOptionalFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
