import { Hono } from 'hono';
import type { Env } from '../index';

const anthropicStatusRouter = new Hono<{ Bindings: Env }>();

/**
 * Check Anthropic API rate limits and account status
 */
anthropicStatusRouter.get('/limits', async (c) => {
  const requestId = crypto.randomUUID().substring(0, 8);
  console.log(`[AnthropicStatus:${requestId}] Checking rate limits and account status`);

  try {
    // Make a minimal API call to get rate limit headers
    // Using the completions endpoint with minimal tokens
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': c.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307', // Use cheapest model for testing
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1,
      }),
    });

    // Extract rate limit headers
    const rateLimitHeaders = {
      'requests-limit': response.headers.get('anthropic-ratelimit-requests-limit'),
      'requests-remaining': response.headers.get('anthropic-ratelimit-requests-remaining'),
      'requests-reset': response.headers.get('anthropic-ratelimit-requests-reset'),
      'tokens-limit': response.headers.get('anthropic-ratelimit-tokens-limit'),
      'tokens-remaining': response.headers.get('anthropic-ratelimit-tokens-remaining'),
      'tokens-reset': response.headers.get('anthropic-ratelimit-tokens-reset'),
      'retry-after': response.headers.get('retry-after'),
    };

    console.log(`[AnthropicStatus:${requestId}] Status: ${response.status}`);
    console.log(`[AnthropicStatus:${requestId}] Rate limit headers:`, rateLimitHeaders);

    // Check different error scenarios
    let status = 'unknown';
    let message = '';
    let details = {};

    if (response.status === 200) {
      status = 'healthy';
      message = 'API is working normally';
      details = {
        ...rateLimitHeaders,
        requestsUsage: rateLimitHeaders['requests-remaining'] && rateLimitHeaders['requests-limit']
          ? `${rateLimitHeaders['requests-limit'] - rateLimitHeaders['requests-remaining']}/${rateLimitHeaders['requests-limit']}`
          : 'N/A',
      };
    } else if (response.status === 429) {
      status = 'rate_limited';
      const errorData = await response.json().catch(() => ({}));
      message = 'Rate limit exceeded';
      details = {
        ...rateLimitHeaders,
        error: errorData,
        retryAfter: rateLimitHeaders['retry-after'] ? `${rateLimitHeaders['retry-after']} seconds` : 'Unknown',
      };
    } else if (response.status === 529) {
      status = 'overloaded';
      message = 'Anthropic API is overloaded (this affects all users)';
      details = {
        ...rateLimitHeaders,
        note: 'This is a global issue, not specific to your account',
      };
    } else if (response.status === 401) {
      status = 'invalid_api_key';
      message = 'Invalid API key';
      details = {
        apiKeyPrefix: c.env.ANTHROPIC_API_KEY ? c.env.ANTHROPIC_API_KEY.substring(0, 10) + '...' : 'Not set',
      };
    } else {
      const errorData = await response.json().catch(() => ({}));
      status = 'error';
      message = `Unexpected status: ${response.status}`;
      details = {
        ...rateLimitHeaders,
        error: errorData,
      };
    }

    return c.json({
      status,
      message,
      details,
      timestamp: new Date().toISOString(),
      requestId,
    });

  } catch (error) {
    console.error(`[AnthropicStatus:${requestId}] Error checking status:`, error);
    return c.json({
      status: 'error',
      message: 'Failed to check Anthropic API status',
      error: error instanceof Error ? error.message : String(error),
      requestId,
    }, 500);
  }
});

/**
 * Get current usage and limits for the account
 */
anthropicStatusRouter.get('/usage', async (c) => {
  const requestId = crypto.randomUUID().substring(0, 8);
  console.log(`[AnthropicStatus:${requestId}] Checking account usage`);

  try {
    // Unfortunately, Anthropic doesn't have a dedicated usage endpoint
    // We need to infer from rate limit headers on a regular API call

    // Make a HEAD request to minimize cost
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': c.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 1,
      }),
    });

    const now = new Date();

    // Parse rate limit headers
    const requestsLimit = parseInt(response.headers.get('anthropic-ratelimit-requests-limit') || '0');
    const requestsRemaining = parseInt(response.headers.get('anthropic-ratelimit-requests-remaining') || '0');
    const requestsReset = response.headers.get('anthropic-ratelimit-requests-reset');
    const tokensLimit = parseInt(response.headers.get('anthropic-ratelimit-tokens-limit') || '0');
    const tokensRemaining = parseInt(response.headers.get('anthropic-ratelimit-tokens-remaining') || '0');
    const tokensReset = response.headers.get('anthropic-ratelimit-tokens-reset');

    const requestsUsed = requestsLimit - requestsRemaining;
    const tokensUsed = tokensLimit - tokensRemaining;

    const usage = {
      requests: {
        used: requestsUsed,
        limit: requestsLimit,
        remaining: requestsRemaining,
        percentUsed: requestsLimit > 0 ? Math.round((requestsUsed / requestsLimit) * 100) : 0,
        resetsAt: requestsReset,
        resetsIn: requestsReset ? `${Math.round((new Date(requestsReset).getTime() - now.getTime()) / 1000)} seconds` : null,
      },
      tokens: {
        used: tokensUsed,
        limit: tokensLimit,
        remaining: tokensRemaining,
        percentUsed: tokensLimit > 0 ? Math.round((tokensUsed / tokensLimit) * 100) : 0,
        resetsAt: tokensReset,
        resetsIn: tokensReset ? `${Math.round((new Date(tokensReset).getTime() - now.getTime()) / 1000)} seconds` : null,
      },
      status: response.status,
      healthy: response.status === 200,
      warnings: [],
    };

    // Add warnings
    if (usage.requests.percentUsed > 80) {
      usage.warnings.push(`Request limit ${usage.requests.percentUsed}% used`);
    }
    if (usage.tokens.percentUsed > 80) {
      usage.warnings.push(`Token limit ${usage.tokens.percentUsed}% used`);
    }
    if (response.status === 429) {
      usage.warnings.push('Rate limit exceeded - requests are being blocked');
    }
    if (response.status === 529) {
      usage.warnings.push('Service overloaded - affecting all users');
    }

    console.log(`[AnthropicStatus:${requestId}] Usage:`, usage);

    return c.json({
      usage,
      timestamp: new Date().toISOString(),
      requestId,
    });

  } catch (error) {
    console.error(`[AnthropicStatus:${requestId}] Error checking usage:`, error);
    return c.json({
      error: 'Failed to check usage',
      message: error instanceof Error ? error.message : String(error),
      requestId,
    }, 500);
  }
});

export { anthropicStatusRouter };