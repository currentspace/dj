/**
 * Check if content contains markdown-like patterns
 *
 * Used to conditionally render markdown vs plain text for optimization.
 *
 * @param content - Content to check
 * @returns true if content likely contains markdown
 */
export function hasMarkdownSyntax(content: string): boolean {
  if (!content) return false

  // Check for common markdown patterns
  return /[*_~`[\]()]|^#{1,6}\s|^[-*+]\s|^\d+\.\s/m.test(content)
}
