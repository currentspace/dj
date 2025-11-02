import type { SpotifyWebhookPayload } from '@dj/shared-types';

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';

// Validation schemas
const SpotifyWebhookPayloadSchema = z.object({
  event: z.enum(['playlist.created', 'playlist.updated', 'playlist.deleted']),
  playlistId: z.string(),
  timestamp: z.string(),
  userId: z.string()
});

const GenericWebhookSchema = z.object({
  payload: z.unknown(),
  signature: z.string().optional(),
  timestamp: z.number(),
  type: z.string()
});

export interface Env {
  ENVIRONMENT: string;
  SESSIONS: KVNamespace;
  SPOTIFY_WEBHOOK_SECRET: string;
  WEBHOOK_SECRET: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({
  credentials: true,
  origin: ['https://dj.current.space', 'https://api.spotify.com']
}));

// Health check
app.get('/health', (c) => c.json({ status: 'healthy', worker: 'webhooks' }));

// Spotify webhook endpoint
app.post('/spotify', async (c) => {
  const signature = c.req.header('X-Spotify-Signature');
  const timestamp = c.req.header('X-Spotify-Timestamp');

  if (!signature || !timestamp) {
    return c.json({ error: 'Missing webhook signature' }, 401);
  }

  const body = await c.req.text();

  // Verify webhook signature
  const isValid = await verifySpotifyWebhook(
    body,
    signature,
    timestamp,
    c.env.SPOTIFY_WEBHOOK_SECRET
  );

  if (!isValid) {
    return c.json({ error: 'Invalid webhook signature' }, 401);
  }

  try {
    let jsonPayload: unknown;
    try {
      jsonPayload = JSON.parse(body);
    } catch {
      return c.json({ error: 'Invalid JSON payload' }, 400);
    }

    const payload = SpotifyWebhookPayloadSchema.safeParse(jsonPayload);

    if (!payload.success) {
      console.error('Invalid Spotify webhook payload:', payload.error);
      return c.json({ error: 'Invalid webhook payload format' }, 400);
    }

    // Process webhook event
    await processSpotifyWebhook(payload.data, c.env);

    return c.json({ processed: payload.data.event, success: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return c.json({ error: 'Failed to process webhook' }, 500);
  }
});

// Generic webhook endpoint for future integrations
app.post('/webhook/:service', async (c) => {
  const service = c.req.param('service');

  try {
    const requestBody = await c.req.json();
    const body = GenericWebhookSchema.safeParse(requestBody);

    if (!body.success) {
      console.error(`Invalid webhook payload from ${service}:`, body.error);
      return c.json({ error: 'Invalid webhook payload format' }, 400);
    }

    console.warn(`Received webhook from ${service}:`, body.data.type);

    // Add service-specific processing here

    return c.json({ event: body.data.type, service, success: true });
  } catch (error) {
    console.error(`Webhook processing error for ${service}:`, error);
    return c.json({ error: 'Failed to process webhook' }, 500);
  }
});

async function processSpotifyWebhook(
  payload: SpotifyWebhookPayload,
  env: Env
): Promise<void> {
  switch (payload.event) {
    case 'playlist.created':
      // Store playlist creation event
      await env.SESSIONS.put(
        `event:playlist:${payload.playlistId}`,
        JSON.stringify({
          createdAt: new Date().toISOString(),
          event: payload.event,
          timestamp: payload.timestamp,
          userId: payload.userId
        }),
        { expirationTtl: 86400 * 30 } // 30 days
      );
      break;

    case 'playlist.deleted':
      // Clean up stored data
      await env.SESSIONS.delete(`event:playlist:${payload.playlistId}`);
      break;

    case 'playlist.updated':
      // Log playlist update
      console.warn(`Playlist ${payload.playlistId} updated by ${payload.userId}`);
      break;

    default:
      console.warn('Unknown Spotify event:', payload.event);
  }
}

async function verifySpotifyWebhook(
  body: string,
  signature: string,
  timestamp: string,
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${timestamp}.${body}`);
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', key, data);
  const expectedSignature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return signature === expectedSignature;
}

export default app;