/**
 * Safe markdown rendering component using react-markdown
 *
 * Uses react-markdown which renders to React components directly,
 * completely avoiding dangerouslySetInnerHTML and XSS vulnerabilities.
 *
 * SECURITY: react-markdown parses markdown and outputs React elements,
 * never raw HTML. This is inherently XSS-safe.
 */
import Markdown from 'react-markdown'

interface MarkdownContentProps {
  children: string
  className?: string
}

/**
 * Render markdown content safely as React components
 *
 * @example
 * <MarkdownContent>**bold** and *italic*</MarkdownContent>
 * // Renders: <p><strong>bold</strong> and <em>italic</em></p>
 *
 * @example
 * // XSS is impossible - HTML is rendered as text
 * <MarkdownContent>**<script>alert("xss")</script>**</MarkdownContent>
 * // Renders: <p><strong>&lt;script&gt;alert("xss")&lt;/script&gt;</strong></p>
 */
export function MarkdownContent({children, className}: MarkdownContentProps) {
  if (!children) return null

  return (
    <div className={className}>
      <Markdown>{children}</Markdown>
    </div>
  )
}

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
  return /[*_~`\[\]()]|^#{1,6}\s|^[-*+]\s|^\d+\.\s/m.test(content)
}
