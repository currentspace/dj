#!/usr/bin/env node
import {execSync} from 'child_process'
import {writeFileSync} from 'fs'

// Get git commit hash (short)
const commitHash = execSync('git rev-parse --short HEAD').toString().trim()

// Get build timestamp
const buildTime = new Date().toISOString()

// Get branch name
const branch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim()

// Get last commit message
const commitMessage = execSync('git log -1 --pretty=%B').toString().trim().split('\n')[0]

const buildInfo = {
  branch,
  buildTime,
  commitHash,
  commitMessage,
  version: `${commitHash}-${Date.now()}`,
}

// Write to multiple locations
const locations = ['./apps/web/src/build-info.json', './workers/api/src/build-info.json']

locations.forEach(location => {
  try {
    writeFileSync(location, JSON.stringify(buildInfo, null, 2))
    console.log(`✅ Build info written to ${location}`)
  } catch (error) {
    console.error(`❌ Failed to write to ${location}:`, error.message)
  }
})

// Also update the service worker version
// This ensures the SW file changes on each build, triggering browser update detection
const swPath = './apps/web/public/sw.js'
try {
  const {readFileSync} = await import('fs')
  let swContent = readFileSync(swPath, 'utf-8')

  // Replace the version constant
  const newVersion = `${commitHash}-${Date.now()}`
  swContent = swContent.replace(
    /const SW_VERSION = '[^']+'/,
    `const SW_VERSION = '${newVersion}'`
  )

  writeFileSync(swPath, swContent)
  console.log(`✅ Service worker version updated to ${newVersion}`)
} catch (error) {
  console.error(`❌ Failed to update service worker:`, error.message)
}

console.log('Build info:', buildInfo)
