export function canApplySuggestedEdit(input: {
  original: string;
  current: string;
}): { ok: true } | { ok: false; reason: string } {
  if (input.current !== input.original) {
    return {
      ok: false,
      reason:
        "The note changed after this suggestion was generated. Re-run the suggestion before applying."
    };
  }
  return { ok: true };
}
