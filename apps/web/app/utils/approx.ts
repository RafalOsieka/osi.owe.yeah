/**
 * A sentence with "≈ €5.50" in it, its "≈" kept on the same line as the amount it marks (a
 * no-break space), e.g. "your share ≈ €5.50", for text that may wrap.
 */
export function keepApprox(text: string): string {
  return text.replaceAll('≈ ', '≈ ');
}
