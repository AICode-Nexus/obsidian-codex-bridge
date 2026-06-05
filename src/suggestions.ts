export function extractUpdatedNoteFromSuggestion(suggestion: string): string | null {
  const match = suggestion.match(/```markdown\s+updated-note\s*\n([\s\S]*?)\n```/i);
  return match?.[1]?.trim() ?? null;
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
