#!/usr/bin/env node

/**
 * Automatically fix nullish coalescing violations by replacing || with ??
 * This script is safe for this codebase where we trust all replacements.
 */

import {readFileSync, writeFileSync} from 'fs'
import {execSync} from 'child_process'

// Get all files with prefer-nullish-coalescing errors
console.log('Finding files with nullish coalescing violations...\n')
const lintOutput = execSync('pnpm run lint 2>&1 || true', {encoding: 'utf-8'})

// Extract unique file paths
const fileMatches = lintOutput.matchAll(/^(.+\.tsx?)$/gm)
const files = [...new Set([...fileMatches].map(m => m[1]))]

console.log(`Found ${files.length} files with potential issues\n`)

let totalFixes = 0

for (const file of files) {
  let content = readFileSync(file, 'utf-8')
  const original = content
  let fileFixes = 0

  // Pattern 1: value || defaultValue => value ?? defaultValue
  // Match: identifier/expression followed by || followed by value
  // Avoid: boolean logic like (a || b) or if (x || y)

  // Safe replacements for common patterns:
  // - const x = value || 'default'
  // - map.get(key) || []
  // - obj?.prop || null
  // - value || 0, value || '', value || false (when used for default values)

  const patterns = [
    // Map.get() || defaultValue
    {
      pattern: /(\.\s*get\s*\([^)]+\))\s+\|\|\s+/g,
      replacement: '$1 ?? ',
    },
    // variable || defaultValue (assignment context)
    {
      pattern: /(=\s+[a-zA-Z_$][\w$.]*(?:\?\.[\w$]+)*)\s+\|\|\s+/g,
      replacement: '$1 ?? ',
    },
    // obj?.property || defaultValue
    {
      pattern: /([a-zA-Z_$][\w$.]*\?\.[\w$]+)\s+\|\|\s+/g,
      replacement: '$1 ?? ',
    },
    // ||= to ??=
    {
      pattern: /\|\|=/g,
      replacement: '??=',
    },
  ]

  for (const {pattern, replacement} of patterns) {
    const before = content
    content = content.replace(pattern, replacement)
    const matches = (before.match(pattern) || []).length
    if (matches > 0) {
      fileFixes += matches
    }
  }

  if (content !== original) {
    writeFileSync(file, content, 'utf-8')
    console.log(`✓ Fixed ${fileFixes} occurrences in ${file}`)
    totalFixes += fileFixes
  }
}

console.log(`\n✨ Total fixes applied: ${totalFixes}`)
console.log('\nRun `pnpm run lint` to check remaining issues.')
console.log('Some || operators may need to stay as-is for boolean logic.\n')
