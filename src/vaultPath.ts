export interface FileSystemAdapterLike {
  basePath?: unknown;
  getBasePath?: () => string;
}

export function resolveVaultPath(adapter: unknown): string | null {
  if (!adapter || typeof adapter !== "object") {
    return null;
  }

  const candidate = adapter as FileSystemAdapterLike;
  if (typeof candidate.getBasePath === "function") {
    const path = candidate.getBasePath();
    return path || null;
  }
  if (typeof candidate.basePath === "string") {
    return candidate.basePath || null;
  }
  return null;
}
