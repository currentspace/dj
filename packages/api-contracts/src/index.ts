/**
 * API Contracts Package
 * Contract-first API definitions using Hono + Zod + OpenAPI
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';

// Export route definitions
export * from './routes/auth';
export * from './routes/playlists';
export * from './routes/chat';

/**
 * Build the OpenAPI-enabled Hono app
 * This is the contract that both server and client use
 */
export function buildApiApp() {
  const app = new OpenAPIHono();

  // Configure OpenAPI documentation
  app.doc('/api/openapi.json', {
    info: {
      description: 'AI-powered Spotify playlist generator',
      title: 'DJ API',
      version: '1.0.0',
    },
    openapi: '3.0.0',
    servers: [
      {
        description: 'Production',
        url: 'https://dj.current.space',
      },
      {
        description: 'Local development',
        url: 'http://localhost:8787',
      },
    ],
  });

  // Serve Swagger UI at /api/docs
  app.get('/api/docs', (c: Context) => {
    return c.html(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>DJ API Documentation</title>
          <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
        </head>
        <body>
          <div id="swagger-ui"></div>
          <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
          <script>
            window.onload = () => {
              window.ui = SwaggerUIBundle({
                url: '/api/openapi.json',
                dom_id: '#swagger-ui',
              });
            };
          </script>
        </body>
      </html>
    `);
  });

  return app;
}

/**
 * App type for client-side type inference
 * Export this to use with hc<AppType>()
 */
export type AppType = ReturnType<typeof buildApiApp>;
