export function extractUpdatedNoteFromSuggestion(suggestion: string): string | null {
  const lines = suggestion.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(`{3,}|~{3,})\s*markdown\s+updated-note\s*$/i);
    if (!match) {
      continue;
    }

    const marker = match[1][0];
    const length = match[1].length;
    for (let end = index + 1; end < lines.length; end += 1) {
      const closing = lines[end].match(new RegExp(`^\\${marker}{${length},}\\s*$`));
      if (closing) {
        return lines.slice(index + 1, end).join("\n").trim();
      }
    }
  }
  return null;
}

export function buildDiffPreview(before: string, after: string): string {
  if (before === after) {
    return "No changes.";
  }

  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const preview: string[] = [];
  const max = Math.max(beforeLines.length, afterLines.length);

  for (let index = 0; index < max; index += 1) {
    const oldLine = beforeLines[index];
    const newLine = afterLines[index];
    if (oldLine === newLine) {
      preview.push(`  ${oldLine ?? ""}`);
      continue;
    }
    if (oldLine !== undefined) {
      preview.push(`- ${oldLine}`);
    }
    if (newLine !== undefined) {
      preview.push(`+ ${newLine}`);
    }
  }

  return preview.join("\n");
}
