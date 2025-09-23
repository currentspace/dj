# DJ App Refactoring Proposal

## Executive Summary

This proposal outlines a comprehensive refactoring of the DJ app to align with React 19.1 best practices, modern Cloudflare Workers patterns, and canonical directory structures. The refactoring will improve maintainability, performance, and developer experience.

## 1. Directory Structure Refactoring

### Current Structure
```
/
├── web/src/          # React app
├── src/worker/       # Cloudflare Worker
└── docs/             # Documentation
```

### Proposed Structure
```
/
├── apps/
│   └── web/                    # React 19.1 application
│       ├── src/
│       │   ├── app/            # App-level components & providers
│       │   ├── features/       # Feature-based modules
│       │   │   ├── playlist/   # Playlist generation feature
│       │   │   ├── auth/       # Spotify authentication
│       │   │   └── player/     # Music player feature
│       │   ├── components/     # Shared UI components
│       │   ├── hooks/          # Custom React hooks
│       │   ├── lib/            # Utilities & helpers
│       │   └── styles/         # Global styles & themes
│       └── public/
│
├── packages/
│   ├── api-client/             # Typed API client package
│   ├── shared-types/           # Shared TypeScript types
│   └── ui/                     # Shared UI component library
│
├── workers/
│   ├── api/                    # Main API worker
│   │   ├── src/
│   │   │   ├── routes/         # API routes
│   │   │   ├── middleware/     # Hono middleware
│   │   │   ├── services/       # Business logic services
│   │   │   └── lib/            # Worker utilities
│   │   └── wrangler.toml
│   │
│   └── webhooks/               # Webhook handler worker
│       ├── src/
│       │   ├── handlers/       # Webhook event handlers
│       │   └── lib/            # Webhook utilities
│       └── wrangler.toml
│
├── docs/                       # Documentation
└── config/                     # Shared configuration
```

## 2. Dependency Updates

### Core Dependencies
```json
{
  "dependencies": {
    "react": "^19.1.1",
    "react-dom": "^19.1.1",
    "hono": "^4.9.8",
    "@ark-ui/react": "^5.25.0"  // Update from 3.13.0
  }
}
```

### Development Dependencies
```json
{
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20241127.0",
    "@types/react": "^19.1.13",
    "@types/react-dom": "^19.1.9",
    "typescript": "^5.9.2",
    "vite": "^7.1.6",              // Update from 6.3.6
    "@vitejs/plugin-react": "^5.0.3",  // Update from 4.7.0
    "wrangler": "^3.114.14",       // Keep v3 (v4 not yet available)
    "eslint": "^9.36.0",           // Update from 8.57.1
    "vitest": "^3.2.0"             // Add for testing
  }
}
```

## 3. React 19.1 Pattern Implementation

### A. Use the new `use` API for async operations
```tsx
// Instead of useEffect + useState
function PlaylistGenerator() {
  const playlistData = use(generatePlaylistPromise);
  // React will Suspend until promise resolves
}
```

### B. Implement Server Actions
```tsx
// app/web/src/features/playlist/actions.ts
'use server';

export async function generatePlaylistAction(formData: FormData) {
  const prompt = formData.get('prompt');
  // Server-side logic here
}
```

### C. Use new form hooks
```tsx
// Using useActionState for forms
function PlaylistForm() {
  const [state, formAction, isPending] = useActionState(
    generatePlaylistAction,
    null
  );

  const [optimisticPlaylist, addOptimisticPlaylist] = useOptimistic(
    state?.playlist,
    (state, newPlaylist) => newPlaylist
  );
}
```

### D. Implement Error Boundaries
```tsx
// app/web/src/app/ErrorBoundary.tsx
export function PlaylistErrorBoundary({ children }) {
  return (
    <ErrorBoundary
      fallback={<PlaylistErrorFallback />}
      onReset={() => window.location.reload()}
    >
      {children}
    </ErrorBoundary>
  );
}
```

## 4. Cloudflare Workers Best Practices

### A. Separate Workers for Different Concerns
```typescript
// workers/api/src/index.ts - Main API
export default {
  async fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  }
}

// workers/webhooks/src/index.ts - Webhook handler
export default {
  async fetch(request, env, ctx) {
    return webhookHandler.fetch(request, env, ctx);
  }
}
```

### B. Implement Webhook Verification
```typescript
// workers/webhooks/src/lib/verify.ts
export async function verifySpotifyWebhook(
  request: Request,
  secret: string
): Promise<boolean> {
  const signature = request.headers.get('X-Spotify-Signature');
  const body = await request.text();
  const expectedSignature = await generateHMAC(body, secret);
  return timingSafeEqual(signature, expectedSignature);
}
```

### C. Use Cloudflare KV for Session Storage
```typescript
// workers/api/src/services/session.ts
export class SessionService {
  constructor(private kv: KVNamespace) {}

  async createSession(userId: string, token: string) {
    const sessionId = crypto.randomUUID();
    await this.kv.put(
      `session:${sessionId}`,
      JSON.stringify({ userId, token }),
      { expirationTtl: 3600 }
    );
    return sessionId;
  }
}
```

## 5. Type Safety Improvements

### A. Shared Types Package
```typescript
// packages/shared-types/src/index.ts
export interface Playlist {
  id: string;
  name: string;
  description: string;
  tracks: Track[];
}

export interface Track {
  id: string;
  name: string;
  artist: string;
  spotifyId?: string;
  spotifyUri?: string;
}
```

### B. Type-Safe API Client
```typescript
// packages/api-client/src/index.ts
import type { Playlist } from '@dj/shared-types';

export class DJApiClient {
  async generatePlaylist(prompt: string): Promise<Playlist> {
    // Type-safe implementation
  }
}
```

## 6. Configuration Updates

### A. Update wrangler.toml for multiple workers
```toml
# workers/api/wrangler.toml
name = "dj-api"
main = "src/index.ts"
compatibility_date = "2024-12-01"
compatibility_flags = ["nodejs_compat_v2"]

[[kv_namespaces]]
binding = "SESSIONS"
id = "your-kv-namespace-id"

[[routes]]
pattern = "api.dj.current.space/*"
zone_name = "current.space"

# workers/webhooks/wrangler.toml
name = "dj-webhooks"
main = "src/index.ts"

[[routes]]
pattern = "webhooks.dj.current.space/*"
zone_name = "current.space"
```

### B. Update Vite config for React 19
```typescript
// apps/web/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [
          ['babel-plugin-react-compiler', {}]
        ]
      }
    })
  ],
  build: {
    target: 'esnext',
    minify: 'esbuild'
  }
});
```

### C. ESLint 9 Flat Config
```javascript
// eslint.config.js
import js from '@eslint/js';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import typescriptPlugin from '@typescript-eslint/eslint-plugin';

export default [
  js.configs.recommended,
  {
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      '@typescript-eslint': typescriptPlugin
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  }
];
```

## 7. Performance Optimizations

### A. Implement React Suspense Boundaries
```tsx
<Suspense fallback={<PlaylistSkeleton />}>
  <PlaylistGenerator />
</Suspense>
```

### B. Use React.memo strategically
```tsx
const TrackItem = memo(({ track }: { track: Track }) => {
  // Component implementation
}, (prevProps, nextProps) => {
  return prevProps.track.id === nextProps.track.id;
});
```

### C. Implement Cloudflare Cache
```typescript
// workers/api/src/middleware/cache.ts
export async function withCache(
  request: Request,
  handler: () => Promise<Response>
): Promise<Response> {
  const cache = caches.default;
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  const response = await handler();
  await cache.put(request, response.clone());
  return response;
}
```

## 8. Testing Infrastructure

### Add Vitest for unit testing
```typescript
// apps/web/src/features/playlist/playlist.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PlaylistGenerator } from './PlaylistGenerator';

describe('PlaylistGenerator', () => {
  it('renders correctly', () => {
    const { getByText } = render(<PlaylistGenerator />);
    expect(getByText('Generate Playlist')).toBeDefined();
  });
});
```

## 9. Monitoring and Observability

### Add Cloudflare Analytics
```typescript
// workers/api/src/middleware/analytics.ts
export function trackEvent(
  env: Env,
  event: string,
  properties: Record<string, any>
) {
  env.ANALYTICS.writeDataPoint({
    blobs: [event],
    doubles: [Date.now()],
    indexes: [JSON.stringify(properties)]
  });
}
```

## 10. Security Enhancements

### A. Content Security Policy
```typescript
// workers/api/src/middleware/security.ts
export function addSecurityHeaders(response: Response): Response {
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline';"
  );
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  return response;
}
```

### B. Rate Limiting
```typescript
// workers/api/src/middleware/rateLimit.ts
export async function rateLimit(
  request: Request,
  env: Env
): Promise<boolean> {
  const ip = request.headers.get('CF-Connecting-IP');
  const key = `rate:${ip}`;
  const count = await env.KV.get(key);

  if (count && parseInt(count) > 100) {
    return false;
  }

  await env.KV.put(key, String((parseInt(count || '0') + 1)), {
    expirationTtl: 3600
  });

  return true;
}
```

## Implementation Plan

1. **Phase 1**: Update dependencies and ESLint configuration
2. **Phase 2**: Refactor directory structure
3. **Phase 3**: Implement React 19.1 patterns
4. **Phase 4**: Split workers and add webhook handling
5. **Phase 5**: Add testing infrastructure
6. **Phase 6**: Implement security and monitoring

## Migration Checklist

- [ ] Backup current code
- [ ] Update all dependencies
- [ ] Migrate to new directory structure
- [ ] Update import paths
- [ ] Implement new React patterns
- [ ] Split worker functionality
- [ ] Add webhook handlers
- [ ] Update CI/CD pipeline
- [ ] Test all functionality
- [ ] Deploy to staging
- [ ] Verify production deployment

## Conclusion

This refactoring will modernize the DJ app architecture, improve performance, and establish patterns for future development. The modular structure will make the codebase more maintainable and scalable.