export interface MarkdownFileLike {
  extension: string;
  path: string;
}

export function resolveCurrentMarkdownFile<T extends MarkdownFileLike>(
  activeFile: T | null,
  lastMarkdownFile: T | null
): T | null {
  if (activeFile?.extension === "md") {
    return activeFile;
  }
  if (lastMarkdownFile?.extension === "md") {
    return lastMarkdownFile;
  }
  return null;
}
