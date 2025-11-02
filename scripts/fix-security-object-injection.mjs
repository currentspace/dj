#!/usr/bin/env node

/**
 * Fix security/detect-object-injection errors
 *
 * This rule flags dynamic property access like obj[variable]
 * The fix: Either validate the key or use a Map instead
 */

import {readFileSync, writeFileSync} from 'fs'
import {execSync} from 'child_process'

// Get files with object injection errors
const lintOutput = execSync('pnpm run lint 2>&1 || true', {encoding: 'utf-8'})

const pattern = /^(.+\.tsx?):(\d+):(\d+)\s+error.*security\/detect-object-injection/gm
const violations = []

let match
while ((match = pattern.exec(lintOutput)) !== null) {
  const [, filePath, line] = match
  violations.push({file: filePath, line: parseInt(line)})
}

console.log(`Found ${violations.length} security/detect-object-injection violations\n`)

// Group by file
const byFile = violations.reduce((acc, v) => {
  if (!acc[v.file]) acc[v.file] = []
  acc[v.file].push(v.line)
  return acc
}, {})

for (const [file, lines] of Object.entries(byFile)) {
  console.log(`\n${file}:`)
  const content = readFileSync(file, 'utf-8').split('\n')

  for (const lineNum of lines) {
    const line = content[lineNum - 1]
    console.log(`  Line ${lineNum}: ${line.trim()}`)

    // Common patterns and suggested fixes:
    if (line.includes('this.items[')) {
      console.log(`    → Suggestion: Use Map instead of array/object for dynamic access`)
    } else if (line.includes('[index]') || line.includes('[i]')) {
      console.log(`    → Suggestion: This is array access, likely a false positive`)
      console.log(`    → Consider: // eslint-disable-next-line security/detect-object-injection`)
    } else if (line.includes('[key]') || line.includes('[name]')) {
      console.log(`    → Suggestion: Validate key before access: if (Object.hasOwn(obj, key))`)
    }
  }
}

console.log('\n\nTo fix these:')
console.log('1. For dynamic object access: Use Map instead of object')
console.log('2. For validated keys: Add Object.hasOwn() check')
console.log('3. For array indices: Add eslint-disable comment (false positive)')
console.log('4. For truly safe access: Add eslint-disable with explanation\n')
