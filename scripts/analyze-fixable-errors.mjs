#!/usr/bin/env node

/**
 * Analyze which ESLint errors are fixable (have auto-fix or suggestions)
 * Helps prioritize which rules to fix first
 */

import { ESLint } from 'eslint'

async function analyzeFixableErrors() {
  const eslint = new ESLint({
    cache: false,
    fix: false,
  })

  console.log('Analyzing ESLint errors...\n')

  const results = await eslint.lintFiles(['.'])

  const errorStats = new Map()

  for (const result of results) {
    for (const message of result.messages) {
      if (message.severity !== 2) continue // Only errors

      const ruleId = message.ruleId || 'unknown'

      if (!errorStats.has(ruleId)) {
        errorStats.set(ruleId, {
          count: 0,
          files: new Set(),
          fixable: 0,
          hasSuggestions: 0,
        })
      }

      const stats = errorStats.get(ruleId)
      stats.count++
      stats.files.add(result.filePath)

      if (message.fix) {
        stats.fixable++
      }
      if (message.suggestions && message.suggestions.length > 0) {
        stats.hasSuggestions++
      }
    }
  }

  // Sort by count
  const sorted = Array.from(errorStats.entries()).sort((a, b) => b[1].count - a[1].count)

  console.log('=== ERROR ANALYSIS ===\n')
  console.log(
    'Rule ID                                      | Total | Auto-Fix | Suggestions | Files',
  )
  console.log('─'.repeat(100))

  for (const [ruleId, stats] of sorted) {
    const canFix = stats.fixable > 0 || stats.hasSuggestions > 0
    const marker = canFix ? '✓' : '✗'

    console.log(
      `${marker} ${ruleId.padEnd(43)} | ${String(stats.count).padStart(5)} | ${String(stats.fixable).padStart(8)} | ${String(stats.hasSuggestions).padStart(11)} | ${stats.files.size}`,
    )
  }

  const totalErrors = Array.from(errorStats.values()).reduce((sum, s) => sum + s.count, 0)
  const totalFixable = Array.from(errorStats.values()).reduce((sum, s) => sum + s.fixable, 0)
  const totalSuggestions = Array.from(errorStats.values()).reduce(
    (sum, s) => sum + s.hasSuggestions,
    0,
  )

  console.log('\n=== SUMMARY ===')
  console.log(`Total errors: ${totalErrors}`)
  console.log(`Auto-fixable: ${totalFixable}`)
  console.log(`With suggestions: ${totalSuggestions}`)
  console.log(`Potentially fixable: ${totalFixable + totalSuggestions}\n`)

  // Show top fixable rules
  const fixable = sorted.filter(([_, stats]) => stats.fixable > 0 || stats.hasSuggestions > 0)

  if (fixable.length > 0) {
    console.log('=== TOP FIXABLE RULES (run these first) ===\n')
    for (const [ruleId, stats] of fixable.slice(0, 10)) {
      const totalFixable = stats.fixable + stats.hasSuggestions
      console.log(`  node scripts/fix-by-rule.mjs "${ruleId}"  # ${totalFixable} fixable`)
    }
  }
}

analyzeFixableErrors().catch(console.error)
