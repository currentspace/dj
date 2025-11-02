#!/usr/bin/env node

/**
 * Fix ESLint issues by specific rule ID
 * Usage: node scripts/fix-by-rule.mjs <ruleId>
 * Example: node scripts/fix-by-rule.mjs jsx-a11y/click-events-have-key-events
 */

import { ESLint } from 'eslint'
import { writeFileSync } from 'fs'

const ruleToFix = process.argv[2]

if (!ruleToFix) {
  console.error('Usage: node scripts/fix-by-rule.mjs <ruleId>')
  console.error('Example: node scripts/fix-by-rule.mjs jsx-a11y/click-events-have-key-events')
  process.exit(1)
}

async function fixByRule() {
  const eslint = new ESLint({
    cache: false,
    fix: false,
  })

  console.log(`Finding violations of rule: ${ruleToFix}\n`)

  const results = await eslint.lintFiles(['.'])

  let totalFixed = 0
  const filesToFix = new Map()

  // Collect all fixes and suggestions for the specific rule
  for (const result of results) {
    if (!result.messages.length) continue

    const fixes = []

    for (const message of result.messages) {
      if (message.ruleId === ruleToFix) {
        // Try auto-fix first
        if (message.fix) {
          fixes.push(message.fix)
        }
        // Try suggestions if no auto-fix
        else if (message.suggestions && message.suggestions[0]?.fix) {
          fixes.push(message.suggestions[0].fix)
        }
      }
    }

    if (fixes.length > 0) {
      filesToFix.set(result.filePath, {
        fixes: fixes.sort((a, b) => b.range[0] - a.range[0]), // Sort reverse to apply from end to start
        source: result.source,
      })
    }
  }

  console.log(`Found ${filesToFix.size} files with fixable ${ruleToFix} violations\n`)

  // Apply fixes
  for (const [filePath, { fixes, source }] of filesToFix.entries()) {
    let fixed = source

    // Apply fixes from end to start to preserve indices
    for (const fix of fixes) {
      fixed = fixed.slice(0, fix.range[0]) + fix.text + fixed.slice(fix.range[1])
    }

    writeFileSync(filePath, fixed, 'utf-8')
    console.log(
      `✓ Fixed ${fixes.length} occurrences in ${filePath.replace(process.cwd() + '/', '')}`,
    )
    totalFixed += fixes.length
  }

  console.log(`\n✨ Total fixes applied: ${totalFixed}\n`)
}

fixByRule().catch(console.error)
