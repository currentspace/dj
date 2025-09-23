#!/bin/bash
set -e

echo "Building DJ Worker..."

# Install dependencies at root
echo "Installing root dependencies..."
pnpm install

# Build shared packages
echo "Building shared packages..."
pnpm --filter @dj/shared-types build
pnpm --filter @dj/api-client build

# Build React app
echo "Building React app..."
pnpm --filter @dj/web build

# Build worker
echo "Building worker..."
cd workers/api
pnpm install
pnpm run build

echo "✅ Build complete!"