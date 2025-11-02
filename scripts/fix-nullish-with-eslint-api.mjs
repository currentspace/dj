#!/usr/bin/env node

/**
 * Apply ESLint suggestions for @typescript-eslint/prefer-nullish-coalescing
 * using ESLint's programmatic API
 */

import { ESLint } from 'eslint';
import { writeFileSync } from 'fs';

async function fixNullishCoalescing() {
  const eslint = new ESLint({
    fix: false, // We'll apply suggestions manually
    cache: false,
  });

  console.log('Running ESLint to find prefer-nullish-coalescing violations...\n');

  const results = await eslint.lintFiles(['.']);

  let totalFixed = 0;
  const filesToFix = new Map();

  // Collect all suggestions for prefer-nullish-coalescing
  for (const result of results) {
    if (!result.messages.length) continue;

    const fixes = [];

    for (const message of result.messages) {
      if (message.ruleId === '@typescript-eslint/prefer-nullish-coalescing' && message.suggestions) {
        // Take the first suggestion (usually the correct one)
        if (message.suggestions[0]?.fix) {
          fixes.push(message.suggestions[0].fix);
        }
      }
    }

    if (fixes.length > 0) {
      filesToFix.set(result.filePath, {
        source: result.source,
        fixes: fixes.sort((a, b) => b.range[0] - a.range[0]) // Sort reverse to apply from end to start
      });
    }
  }

  console.log(`Found ${filesToFix.size} files with fixable violations\n`);

  // Apply fixes
  for (const [filePath, { source, fixes }] of filesToFix.entries()) {
    let fixed = source;

    // Apply fixes from end to start to preserve indices
    for (const fix of fixes) {
      fixed = fixed.slice(0, fix.range[0]) + fix.text + fixed.slice(fix.range[1]);
    }

    writeFileSync(filePath, fixed, 'utf-8');
    console.log(`✓ Fixed ${fixes.length} occurrences in ${filePath.replace(process.cwd() + '/', '')}`);
    totalFixed += fixes.length;
  }

  console.log(`\n✨ Total fixes applied: ${totalFixed}\n`);
}

fixNullishCoalescing().catch(console.error);
