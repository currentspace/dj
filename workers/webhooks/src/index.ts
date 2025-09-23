import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { WebhookEvent, SpotifyWebhookPayload } from '@dj/shared-types';

export interface Env {
  WEBHOOK_SECRET: string;
  SPOTIFY_WEBHOOK_SECRET: string;
  ENVIRONMENT: string;
  SESSIONS: KVNamespace;
}

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({
  origin: ['https://dj.current.space', 'https://api.spotify.com'],
  credentials: true
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
    const payload: SpotifyWebhookPayload = JSON.parse(body);

    // Process webhook event
    await processSpotifyWebhook(payload, c.env);

    return c.json({ success: true, processed: payload.event });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return c.json({ error: 'Failed to process webhook' }, 500);
  }
});

// Generic webhook endpoint for future integrations
app.post('/webhook/:service', async (c) => {
  const service = c.req.param('service');
  const body = await c.req.json<WebhookEvent>();

  console.log(`Received webhook from ${service}:`, body.type);

  // Add service-specific processing here

  return c.json({ success: true, service, event: body.type });
});

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
    { name: 'HMAC', hash: 'SHA-256' },
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
          event: payload.event,
          userId: payload.userId,
          timestamp: payload.timestamp,
          createdAt: new Date().toISOString()
        }),
        { expirationTtl: 86400 * 30 } // 30 days
      );
      break;

    case 'playlist.updated':
      // Log playlist update
      console.log(`Playlist ${payload.playlistId} updated by ${payload.userId}`);
      break;

    case 'playlist.deleted':
      // Clean up stored data
      await env.SESSIONS.delete(`event:playlist:${payload.playlistId}`);
      break;

    default:
      console.warn('Unknown Spotify event:', payload.event);
  }
}

export default app;